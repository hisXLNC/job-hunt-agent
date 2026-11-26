package sources

import (
	"errors"
	"testing"
)

func TestARefusalByCountryIsNotARefusedKey(t *testing.T) {
	for _, c := range []struct {
		status int
		body   string
		want   error
	}{
		{403, `<html><title>Access denied</title>This service is not available in your country</html>`, ErrBlockedHere},
		{451, ``, ErrBlockedHere},
		{403, `{"exception":"AUTH_FAIL"}`, ErrKeyRefused},
		{401, `{"display":"Authorisation failed"}`, ErrKeyRefused},
		{403, ``, ErrKeyRefused},
	} {
		got := keyedErr(kindAdzuna, &HTTPError{Status: c.status, Body: c.body})
		if !errors.Is(got, c.want) {
			t.Errorf("%d %q: %v, want %v", c.status, c.body, got, c.want)
		}
	}
	if isLinkedIn("media.licdn.com") || !isLinkedIn("www.linkedin.com") || !isLinkedIn("ca.linkedin.com") || isLinkedIn("notlinkedin.com") {
		t.Error("which hosts are LinkedIn's")
	}
}
