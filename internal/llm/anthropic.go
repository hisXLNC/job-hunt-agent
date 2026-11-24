package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// API reaches Claude with an Anthropic API key.
type API struct {
	Key   string
	Model string // "" = DefaultModel

	client *anthropic.Client
}

func (a *API) Name() string { return "api" }

func (a *API) model() string {
	if a.Model != "" {
		return a.Model
	}
	return DefaultModel
}

func (a *API) Do(ctx context.Context, req Request) (Response, error) {
	if strings.TrimSpace(a.Key) == "" {
		return Response{}, ErrNotConnected
	}
	if a.client == nil {
		c := anthropic.NewClient(option.WithAPIKey(strings.TrimSpace(a.Key)), option.WithMaxRetries(2))
		a.client = &c
	}
	model := a.model()
	maxTokens := int64(req.MaxTokens)
	if maxTokens <= 0 {
		maxTokens = 16000
	}
	effort := req.Effort
	if effort == "" {
		effort = "medium"
	}

	prompt := req.Prompt
	params := anthropic.BetaMessageNewParams{
		Model:     model,
		MaxTokens: maxTokens,
		// The system text is the same for every call of a task, so it is cached.
		System: []anthropic.BetaTextBlockParam{{
			Text:         req.System,
			CacheControl: anthropic.NewBetaCacheControlEphemeralParam(),
		}},
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffort(effort)},
	}
	if req.Web {
		// Web answers carry citations, which can't be combined with a fixed
		// answer shape, so the shape is asked for in words instead.
		params.Tools = []anthropic.BetaToolUnionParam{{OfWebSearchTool20260209: &anthropic.BetaWebSearchTool20260209Param{
			MaxUses: anthropic.Int(8),
		}}}
		if req.Schema != nil {
			shape, _ := json.Marshal(req.Schema)
			prompt += "\n\nWhen you have what you need, answer with one JSON object and nothing else, matching this JSON Schema:\n" + string(shape)
		}
	} else if req.Schema != nil {
		params.OutputConfig.Format = anthropic.BetaJSONOutputFormatParam{Schema: req.Schema}
	}
	// If a safety filter declines a request, let a sibling model answer
	// inside the same call. Haiku has no such fallback.
	if !strings.Contains(model, "haiku") {
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
	}
	var blocks []anthropic.BetaContentBlockParamUnion
	for _, im := range req.Images {
		blocks = append(blocks, anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
			Data: base64.StdEncoding.EncodeToString(im.Data), MediaType: anthropic.BetaBase64ImageSourceMediaType(im.Mime),
		}))
	}
	blocks = append(blocks, anthropic.NewBetaTextBlock(prompt))
	params.Messages = []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(blocks...)}

	var out Response
	out.Model = model
	// A server-side search can pause a long turn; sending the conversation
	// back lets it carry on.
	for turn := 0; turn < 6; turn++ {
		msg, err := a.stream(ctx, params)
		if err != nil {
			return out, apiError(err)
		}
		out.TokensIn += msg.Usage.InputTokens + msg.Usage.CacheCreationInputTokens
		out.TokensOut += msg.Usage.OutputTokens
		out.TokensCached += msg.Usage.CacheReadInputTokens
		out.Cost += estimate(model, msg.Usage.InputTokens, msg.Usage.OutputTokens, msg.Usage.CacheReadInputTokens, msg.Usage.CacheCreationInputTokens)

		switch msg.StopReason {
		case anthropic.BetaStopReasonPauseTurn:
			params.Messages = append(params.Messages, msg.ToParam())
			continue
		case anthropic.BetaStopReasonRefusal:
			return out, ErrDeclined
		case anthropic.BetaStopReasonMaxTokens:
			return out, fmt.Errorf("the answer was cut off at %d tokens", maxTokens)
		}
		var text strings.Builder
		for _, block := range msg.Content {
			if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
				text.WriteString(t.Text)
			}
		}
		out.Text = text.String()
		return out, nil
	}
	return out, errors.New("the web search did not finish")
}

func (a *API) stream(ctx context.Context, params anthropic.BetaMessageNewParams) (anthropic.BetaMessage, error) {
	stream := a.client.Beta.Messages.NewStreaming(ctx, params)
	defer stream.Close()
	var msg anthropic.BetaMessage
	for stream.Next() {
		if err := msg.Accumulate(stream.Current()); err != nil {
			return msg, err
		}
	}
	return msg, stream.Err()
}

func apiError(err error) error {
	var apierr *anthropic.Error
	if !errors.As(err, &apierr) {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return &TransientError{fmt.Errorf("couldn't reach Claude: %w", err)}
	}
	switch apierr.StatusCode {
	case 401, 403:
		return &AuthError{"Anthropic did not accept the API key"}
	case 429:
		until := time.Time{}
		if apierr.Response != nil {
			if d, perr := time.ParseDuration(apierr.Response.Header.Get("retry-after") + "s"); perr == nil {
				until = time.Now().Add(d)
			}
		}
		return &LimitError{Msg: "The Anthropic account is at its rate limit", Until: until}
	case 400:
		if strings.Contains(strings.ToLower(apierr.Error()), "credit balance") {
			return &LimitError{Msg: "The Anthropic account is out of credit", Until: time.Now().Add(time.Hour)}
		}
		return fmt.Errorf("Claude rejected the request: %s", short(apierr.Error()))
	case 404:
		return fmt.Errorf("Anthropic doesn't know the model %q", "chosen")
	}
	if apierr.StatusCode >= 500 {
		return &TransientError{fmt.Errorf("Anthropic had a problem (%d)", apierr.StatusCode)}
	}
	return fmt.Errorf("Claude error %d: %s", apierr.StatusCode, short(apierr.Error()))
}

func short(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}
