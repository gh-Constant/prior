package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const calendarProxyMaxBytes int64 = 8 << 20

var calendarProxyClient = &http.Client{
	Timeout: 25 * time.Second,
	Transport: &http.Transport{
		Proxy:                 nil,
		DialContext:           calendarProxyDialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	},
	CheckRedirect: func(request *http.Request, _ []*http.Request) error {
		_, err := validateCalendarProxyURL(request.URL.String())
		return err
	},
}

func (s *Server) calendarICSProxy(w http.ResponseWriter, r *http.Request) {
	_, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "calendar ICS proxy") {
		return
	}

	var body struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid calendar URL request"))
		return
	}
	target, err := validateCalendarProxyURL(body.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	feed, status, err := fetchCalendarProxyFeed(r.Context(), calendarProxyClient, target)
	if err != nil {
		if status > 0 {
			writeError(w, http.StatusBadGateway, fmt.Errorf("calendar source returned %d", status))
		} else {
			writeError(w, http.StatusBadGateway, errors.New("calendar source is unavailable"))
		}
		// The URL can contain a private calendar token, so never include it in
		// logs or error responses.
		return
	}

	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(feed)
}

func validateCalendarProxyURL(raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Hostname() == "" || target.User != nil || target.Fragment != "" {
		return nil, errors.New("calendar URL must be a public http(s) URL")
	}
	if target.Port() != "" {
		if _, err := net.LookupPort("tcp", target.Port()); err != nil {
			return nil, errors.New("calendar URL has an invalid port")
		}
	}
	hostname := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return nil, errors.New("calendar URL must use a public host")
	}
	if ip := net.ParseIP(hostname); ip != nil && !isSafeCalendarIP(ip) {
		return nil, errors.New("calendar URL must use a public host")
	}
	return target, nil
}

func fetchCalendarProxyFeed(ctx context.Context, client *http.Client, target *url.URL) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Accept", "text/calendar, text/plain;q=0.9, */*;q=0.1")
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, response.StatusCode, errors.New("calendar source returned a non-success status")
	}
	feed, err := io.ReadAll(io.LimitReader(response.Body, calendarProxyMaxBytes+1))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if int64(len(feed)) > calendarProxyMaxBytes {
		return nil, response.StatusCode, errors.New("calendar source is too large")
	}
	return feed, response.StatusCode, nil
}

func calendarProxyDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, address := range addresses {
		if !isSafeCalendarIP(address.IP) {
			continue
		}
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("calendar host resolved to a non-public address")
}

func isSafeCalendarIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	for _, blocked := range []string{
		"0.0.0.0/8",
		"100.64.0.0/10",
		"192.0.0.0/24",
		"192.0.2.0/24",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"240.0.0.0/4",
		"2001:db8::/32",
	} {
		_, network, err := net.ParseCIDR(blocked)
		if err == nil && network.Contains(ip) {
			return false
		}
	}
	return true
}
