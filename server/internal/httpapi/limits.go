package httpapi

import (
	"errors"
	"strings"
)

// Shared request caps mirroring the client and store validators:
// task/habit titles <= 400, task description <= 10000, chat message content
// <= 20000, display names <= 80, settings keys <= 2000, push batches <= 100
// mutations, workspace collections <= 5000 items with note bodies <= 1 MiB.
const (
	maxDisplayNameChars = 80
	maxChatTitleChars   = 160
	maxChatContentChars = 20000
	maxDeviceChars      = 120
	maxPlatformChars    = 120
	maxSettingsKeyChars = 2000
	maxPushMutations    = 100
)

func normalizeDevicePlatform(device, platform string) (string, string, error) {
	device = strings.TrimSpace(device)
	platform = strings.TrimSpace(platform)
	if len(device) > maxDeviceChars || len(platform) > maxPlatformChars {
		return "", "", errors.New("device description is too long")
	}
	return device, platform, nil
}
