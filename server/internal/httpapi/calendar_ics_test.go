package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidateCalendarProxyURL(t *testing.T) {
	for _, raw := range []string{
		"https://sedna.univ-fcomte.fr/jsp/custom/ufc/cal.jsp?data=calendar-token,1",
		"http://calendar.example.test/feed.ics",
		"https://[2001:4860:4860::8888]/feed.ics",
	} {
		if _, err := validateCalendarProxyURL(raw); err != nil {
			t.Errorf("validateCalendarProxyURL(%q) returned an unexpected error: %v", raw, err)
		}
	}

	for _, raw := range []string{
		"",
		"file:///etc/passwd",
		"ftp://calendar.example.test/feed.ics",
		"http://localhost/feed.ics",
		"http://127.0.0.1/feed.ics",
		"http://10.0.0.5/feed.ics",
		"http://[::1]/feed.ics",
		"https://user:password@calendar.example.test/feed.ics",
		"https://calendar.example.test/feed.ics#private-fragment",
	} {
		if _, err := validateCalendarProxyURL(raw); err == nil {
			t.Errorf("validateCalendarProxyURL(%q) unexpectedly accepted an unsafe URL", raw)
		}
	}
}

func TestFetchCalendarProxyFeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); !strings.Contains(got, "text/calendar") {
			t.Errorf("upstream Accept header = %q, want text/calendar", got)
		}
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = io.WriteString(w, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
	}))
	defer server.Close()

	target, err := url.Parse(server.URL + "/calendar.ics")
	if err != nil {
		t.Fatal(err)
	}
	feed, status, err := fetchCalendarProxyFeed(context.Background(), server.Client(), target)
	if err != nil {
		t.Fatalf("fetchCalendarProxyFeed returned an error: %v", err)
	}
	if status != http.StatusOK || string(feed) != "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" {
		t.Fatalf("unexpected proxy response: status=%d feed=%q", status, feed)
	}
}

func TestFetchCalendarProxyFeedRejectsOversizedFeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.CopyN(w, strings.NewReader(strings.Repeat("x", int(calendarProxyMaxBytes)+1)), calendarProxyMaxBytes+1)
	}))
	defer server.Close()

	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = fetchCalendarProxyFeed(context.Background(), server.Client(), target)
	if err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("expected oversized feed error, got %v", err)
	}
}
