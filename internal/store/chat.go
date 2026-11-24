package store

import (
	"encoding/json"
	"strings"
)

// Chat is one turn of the conversation with the assistant. Who is "you" or
// "claude". Extra holds what came with a reply: links, what was done, and
// what is waiting for the person's OK.
type Chat struct {
	ID    int64           `json:"id"`
	At    int64           `json:"at"`
	Who   string          `json:"who"`
	Text  string          `json:"text"`
	Extra json.RawMessage `json:"extra"`
}

// AddChat appends a turn.
func (s *Store) AddChat(who, text string, extra any) (int64, error) {
	b := []byte("{}")
	if extra != nil {
		b, _ = json.Marshal(extra)
	}
	res, err := s.db.Exec(`INSERT INTO chat(at, who, text, extra) VALUES(?,?,?,?)`, s.now(), who, text, string(b))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	s.Changed("assistant")
	return id, nil
}

// Chats returns the last n turns, oldest first.
func (s *Store) Chats(n int) ([]Chat, error) {
	rows, err := s.db.Query(`SELECT id, at, who, text, extra FROM chat ORDER BY id DESC LIMIT ?`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Chat
	for rows.Next() {
		var c Chat
		var extra string
		if err := rows.Scan(&c.ID, &c.At, &c.Who, &c.Text, &extra); err != nil {
			return nil, err
		}
		c.Extra = json.RawMessage(extra)
		out = append(out, c)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// ChatTurn returns one turn.
func (s *Store) ChatTurn(id int64) (Chat, error) {
	var c Chat
	var extra string
	err := s.db.QueryRow(`SELECT id, at, who, text, extra FROM chat WHERE id = ?`, id).Scan(&c.ID, &c.At, &c.Who, &c.Text, &extra)
	c.Extra = json.RawMessage(extra)
	return c, notFound(err)
}

// SetChatExtra replaces what came with a turn.
func (s *Store) SetChatExtra(id int64, extra any) error {
	b, _ := json.Marshal(extra)
	_, err := s.db.Exec(`UPDATE chat SET extra = ? WHERE id = ?`, string(b), id)
	s.Changed("assistant")
	return err
}

// ClearChat forgets the conversation. What was done because of it stays done.
func (s *Store) ClearChat() error {
	_, err := s.db.Exec(`DELETE FROM chat`)
	s.db.Exec(`DELETE FROM chat_files`)
	s.Changed("assistant")
	return err
}

// ChatFile is something the person attached to a message. Kind is "text"
// (a document whose words were read), "image", or "other" (kept, but only
// useful for handing on, such as a spreadsheet of connections).
type ChatFile struct {
	ID     int64  `json:"id"`
	ChatID int64  `json:"chat_id"`
	At     int64  `json:"at"`
	Name   string `json:"name"`
	Mime   string `json:"mime"`
	Kind   string `json:"kind"`
	Size   int    `json:"size"`
	Text   string `json:"-"`
	Data   []byte `json:"-"`
}

// AddChatFile keeps an attachment that has not been sent with a message yet.
func (s *Store) AddChatFile(f ChatFile) (int64, error) {
	// Attachments that were picked and never sent are not kept around.
	s.db.Exec(`DELETE FROM chat_files WHERE chat_id = 0 AND at < ?`, s.now()-24*3600)
	res, err := s.db.Exec(`INSERT INTO chat_files(chat_id, at, name, mime, kind, size, text, data) VALUES(0,?,?,?,?,?,?,?)`,
		s.now(), f.Name, f.Mime, f.Kind, len(f.Data), f.Text, f.Data)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ChatFile returns one attachment with its contents.
func (s *Store) ChatFile(id int64) (ChatFile, error) {
	var f ChatFile
	err := s.db.QueryRow(`SELECT id, chat_id, at, name, mime, kind, size, text, data FROM chat_files WHERE id = ?`, id).
		Scan(&f.ID, &f.ChatID, &f.At, &f.Name, &f.Mime, &f.Kind, &f.Size, &f.Text, &f.Data)
	return f, notFound(err)
}

// ChatFiles lists the attachments of the given turns, without their
// contents. Turn 0 means the ones picked but not sent yet.
func (s *Store) ChatFiles(text bool, chatIDs ...int64) ([]ChatFile, error) {
	if len(chatIDs) == 0 {
		return nil, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(chatIDs)), ",")
	args := make([]any, len(chatIDs))
	for i, id := range chatIDs {
		args[i] = id
	}
	col := `''`
	if text {
		col = `text`
	}
	rows, err := s.db.Query(`SELECT id, chat_id, at, name, mime, kind, size, `+col+` FROM chat_files WHERE chat_id IN (`+marks+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatFile
	for rows.Next() {
		var f ChatFile
		if err := rows.Scan(&f.ID, &f.ChatID, &f.At, &f.Name, &f.Mime, &f.Kind, &f.Size, &f.Text); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SendChatFiles ties attachments that were waiting to the message they go with.
func (s *Store) SendChatFiles(chatID int64, ids []int64) error {
	for _, id := range ids {
		if _, err := s.db.Exec(`UPDATE chat_files SET chat_id = ? WHERE id = ? AND chat_id = 0`, chatID, id); err != nil {
			return err
		}
	}
	return nil
}

// DropChatFile removes an attachment that has not been sent.
func (s *Store) DropChatFile(id int64) error {
	_, err := s.db.Exec(`DELETE FROM chat_files WHERE id = ? AND chat_id = 0`, id)
	return err
}
