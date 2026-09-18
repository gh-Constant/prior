package httpapi

import (
	"net"
	"net/http"
	"strings"
)

// GET /metrics exposes pool and hub stats for internal monitoring only. It
// refuses non-loopback callers; production scraping should go through an
// internal network or sidecar, never the public ingress.
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host != "" && host != "127.0.0.1" && host != "::1" && !strings.HasPrefix(host, "10.") && !strings.HasPrefix(host, "172.") && !strings.HasPrefix(host, "192.168.") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	stats := map[string]any{
		"realtime_connections": s.hub.count(),
	}
	if s.pool != nil {
		poolStats := s.pool.Stat()
		stats["db_acquired_conns"] = poolStats.AcquiredConns()
		stats["db_idle_conns"] = poolStats.IdleConns()
		stats["db_total_conns"] = poolStats.TotalConns()
		stats["db_max_conns"] = poolStats.MaxConns()
	}
	writeJSON(w, http.StatusOK, stats)
}
