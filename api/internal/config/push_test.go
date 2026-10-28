package config

import (
	"slices"
	"testing"
)

// Push sends nothing until it is configured: no FCM project, APNs off
// until its whole key is here (a part of it is an error), no internal
// caller; the callers list reads emails only.
func TestPushConfig(t *testing.T) {
	l := hostLoader(nil)
	p := l.push()
	if l.err() != nil || p.FCMProjectID != "" || p.APNsConfigured() || len(p.InternalCallers) != 0 || p.APNsTopic != defaultAPNsTopic {
		t.Fatalf("defaults %+v %v", p, l.err())
	}
	l = hostLoader(map[string]string{"APNS_KEY_ID": "K"})
	if l.push(); l.err() == nil {
		t.Fatal("a part of the APNs key was taken")
	}
	l = hostLoader(map[string]string{
		"FCM_PROJECT_ID": "trycommish", "APNS_KEY_ID": "K", "APNS_TEAM_ID": "T", "APNS_KEY": "pem",
		"INTERNAL_CALLERS": "research-runtime@trycommish.iam.gserviceaccount.com other@trycommish.iam.gserviceaccount.com",
	})
	p = l.push()
	if l.err() != nil || p.FCMProjectID != "trycommish" || !p.APNsConfigured() ||
		!slices.Equal(p.InternalCallers, []string{"research-runtime@trycommish.iam.gserviceaccount.com", "other@trycommish.iam.gserviceaccount.com"}) {
		t.Fatalf("configured %+v %v", p, l.err())
	}
	l = hostLoader(map[string]string{"INTERNAL_CALLERS": "Research <research-runtime@trycommish.iam.gserviceaccount.com>"})
	if l.push(); l.err() == nil {
		t.Fatal("a caller that is not a bare email was taken")
	}
}
