package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

// Two-way Google Calendar (engine/gcal.go). The client secret and the
// sign-in go in and never come out: the pages are told only whether they are
// there. Calendar entries are outside text. None of these calls are on the
// assistant's list or the phone's.
func (s *Server) googleRoutes(h func(string, handler)) {
	e := s.E
	h("GET /api/google", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return e.Google(), nil
	})
	h("PUT /api/google", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in engine.GoogleClientInput
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if err := e.SetGoogleClient(in); err != nil {
			return nil, bad(err.Error())
		}
		return e.Google(), nil
	})
	h("DELETE /api/google", func(w http.ResponseWriter, r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		err := e.ForgetGoogle(ctx)
		return e.Google(), err
	})
	h("POST /api/google/signin", func(w http.ResponseWriter, r *http.Request) (any, error) {
		u, err := e.GoogleSignIn()
		if err != nil {
			return nil, bad(err.Error())
		}
		return map[string]string{"url": u}, nil
	})
	h("POST /api/google/signout", func(w http.ResponseWriter, r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		err := e.GoogleSignOut(ctx)
		return e.Google(), err
	})
	h("POST /api/google/test", func(w http.ResponseWriter, r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		msg, err := e.TestGoogle(ctx)
		if err != nil {
			return nil, bad(err.Error())
		}
		return map[string]string{"message": msg}, nil
	})
	h("POST /api/google/sync", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if !e.GoogleOn() {
			return nil, bad("Sign in with Google first.")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := e.SyncGoogle(ctx); err != nil {
			return nil, bad(err.Error())
		}
		return e.Google(), nil
	})
	h("GET /api/google/lookalikes", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return map[string]any{"lookalikes": e.GoogleLookalikes()}, nil
	})
	h("POST /api/google/lookalikes/{id}/link", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Role int64 `json:"role_id"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		id, err := e.LinkGoogleEvent(r.PathValue("id"), in.Role)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return nil, err
			}
			return nil, bad(err.Error())
		}
		return map[string]int64{"id": id}, nil
	})
	h("POST /api/google/lookalikes/{id}/dismiss", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return nil, e.DismissGoogleEvent(r.PathValue("id"))
	})
}
