package config

import "testing"

func TestDecisionModelDefaultsToJevOnOpenRouter(t *testing.T) {
	t.Setenv("AI_API_KEY", "key")
	t.Setenv("AI_BASE_URL", "")
	t.Setenv("AI_DECISIONS_URL", "")
	t.Setenv("AI_MODEL_DECISIONS", "")
	hosted := loadHostedAI()
	if hosted.DecisionsURL != "https://openrouter.ai/api/alpha/decisions" || hosted.DecisionsModel != "typesafe/jev-1.13" || !hosted.DecisionsEnabled() {
		t.Fatalf("unexpected decision defaults: %q %q", hosted.DecisionsURL, hosted.DecisionsModel)
	}
}

func TestDecisionModelCanBeTurnedOff(t *testing.T) {
	t.Setenv("AI_API_KEY", "key")
	t.Setenv("AI_MODEL_DECISIONS", "off")
	if loadHostedAI().DecisionsEnabled() {
		t.Fatal(`AI_MODEL_DECISIONS=off must disable decisions`)
	}
	t.Setenv("AI_MODEL_DECISIONS", "")
	t.Setenv("AI_DECISIONS_URL", "OFF")
	if loadHostedAI().DecisionsEnabled() {
		t.Fatal(`AI_DECISIONS_URL=off must disable decisions`)
	}
}

func TestDecisionURLNeedsOpenRouterOrAnExplicitURL(t *testing.T) {
	t.Setenv("AI_API_KEY", "key")
	t.Setenv("AI_BASE_URL", "https://api.example.test/v1")
	t.Setenv("AI_DECISIONS_URL", "")
	if loadHostedAI().DecisionsEnabled() {
		t.Fatal("another provider has no decisions endpoint by default")
	}
	t.Setenv("AI_DECISIONS_URL", "https://api.typesafe.ai/v1/systemone/")
	if got := loadHostedAI().DecisionsURL; got != "https://api.typesafe.ai/v1/systemone" {
		t.Fatalf("explicit URL = %q", got)
	}
}
