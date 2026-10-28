package devices

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
)

// Tokens shaped like the platforms': an APNs token in hex, an FCM
// registration token.
var (
	apnsToken = strings.Repeat("ab12", 16)
	fcmToken  = "fcm-token_1:APA91b" + strings.Repeat("x", 40)
)

// pushOf is the device's registration as the table holds it.
func (h harness) pushOf(id uuid.UUID) (platform, token *string) {
	h.t.Helper()
	pool := h.svc.Push.(*Store).Pool
	if err := pool.QueryRow(context.Background(), `select push_platform, push_token from app.devices where id = $1`, id).
		Scan(&platform, &token); err != nil {
		h.t.Fatal(err)
	}
	return platform, token
}

func (h harness) register(token string, id uuid.UUID, platform apitypes.PushPlatform, push string) (int, apitypes.PushRegistered) {
	status, body := h.call(http.MethodPut, "/devices/"+id.String()+"/push", token, apitypes.PushRegistration{Platform: platform, Token: push})
	var out apitypes.PushRegistered
	_ = json.Unmarshal(body, &out)
	return status, out
}

// An app registers its own token, registering again replaces it, the same
// token on another device moves there, DELETE removes it, and unpairing
// the device lets it go.
func TestPushRegistrationRoundTrip(t *testing.T) {
	h, alice, _ := newHarness(t)
	phone := h.pairApp(alice, auth.KindIOS)
	status, reg := h.register(phone.Token, phone.Device.Id, apitypes.PushPlatformApns, apnsToken)
	if status != http.StatusOK || reg.Platform != apitypes.PushPlatformApns || !reg.RegisteredAt.Equal(h.clock.now) {
		t.Fatalf("register: %d %+v", status, reg)
	}
	if p, tok := h.pushOf(phone.Device.Id); *p != "apns" || *tok != apnsToken {
		t.Fatalf("stored %v %v", *p, *tok)
	}

	if status, _ := h.register(phone.Token, phone.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusOK {
		t.Fatalf("register again: %d", status)
	}
	if p, tok := h.pushOf(phone.Device.Id); *p != "fcm" || *tok != fcmToken {
		t.Fatalf("not replaced: %v %v", *p, *tok)
	}

	// The app reinstalled and paired again: the token moves to the new device.
	again := h.pairApp(alice, auth.KindIOS)
	if status, _ := h.register(again.Token, again.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusOK {
		t.Fatalf("register on the new device: %d", status)
	}
	if p, _ := h.pushOf(phone.Device.Id); p != nil {
		t.Fatalf("the old device kept the token: %v", *p)
	}

	if status, _ := h.call(http.MethodDelete, "/devices/"+again.Device.Id.String()+"/push", again.Token, nil); status != http.StatusOK {
		t.Fatalf("delete: %d", status)
	}
	if _, tok := h.pushOf(again.Device.Id); tok != nil {
		t.Fatalf("token kept after delete: %v", *tok)
	}

	if status, _ := h.register(again.Token, again.Device.Id, apitypes.PushPlatformApns, apnsToken); status != http.StatusOK {
		t.Fatalf("register before unpairing: %d", status)
	}
	if status, _ := h.signedIn(h.svc.revoke, alice, http.MethodDelete, again.Device.Id.String()); status != http.StatusOK {
		t.Fatalf("revoke: %d", status)
	}
	if _, tok := h.pushOf(again.Device.Id); tok != nil {
		t.Fatalf("an unpaired device kept its token: %v", *tok)
	}
}

// Only the app itself registers: another device's id is 404, the
// extension's token and a browser cookie never reach the route, and a
// token or platform that does not read is 400 with nothing written.
func TestPushRegistrationIsTheAppsOwn(t *testing.T) {
	h, alice, bob := newHarness(t)
	phone := h.pairApp(alice, auth.KindAndroid)
	other := h.pairApp(bob, auth.KindAndroid)
	if status, _ := h.register(phone.Token, other.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusNotFound {
		t.Fatalf("another member's device: %d", status)
	}
	sibling := h.pairApp(alice, auth.KindIOS)
	if status, _ := h.register(phone.Token, sibling.Device.Id, apitypes.PushPlatformApns, apnsToken); status != http.StatusNotFound {
		t.Fatalf("the account's other device: %d", status)
	}

	status, body := h.call(http.MethodPost, "/devices/pair", "", apitypes.PairInput{Code: h.code(alice)})
	var ext apitypes.Paired
	if status != http.StatusCreated || json.Unmarshal(body, &ext) != nil {
		t.Fatalf("pair the extension: %d", status)
	}
	if status, _ := h.register(ext.Token, ext.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusForbidden {
		t.Fatalf("the extension registered: %d", status)
	}
	if status, _ := h.callWith(http.MethodPut, "/devices/"+phone.Device.Id.String()+"/push", "", h.cookie(alice),
		apitypes.PushRegistration{Platform: apitypes.PushPlatformFcm, Token: fcmToken}); status != http.StatusUnauthorized {
		t.Fatalf("a browser session registered: %d", status)
	}

	for _, bad := range []apitypes.PushRegistration{
		{Platform: "webpush", Token: fcmToken},
		{Platform: apitypes.PushPlatformFcm, Token: "short"},
		{Platform: apitypes.PushPlatformApns, Token: strings.Repeat("a", 30) + " " + strings.Repeat("b", 30)},
		{Platform: apitypes.PushPlatformApns, Token: strings.Repeat("a", maxPushToken+1)},
	} {
		status, _ := h.call(http.MethodPut, "/devices/"+phone.Device.Id.String()+"/push", phone.Token, bad)
		if status != http.StatusBadRequest {
			t.Fatalf("%+v: %d", bad.Platform, status)
		}
	}
	if _, tok := h.pushOf(phone.Device.Id); tok != nil {
		t.Fatalf("a refused registration wrote %v", *tok)
	}
}

// Another member's active device keeps its token: registering it here is
// 409 and moves nothing (security review L4); once that device is past
// the session's life the token moves, so a phone that changed hands is
// not locked out.
func TestPushTokenAcrossAccounts(t *testing.T) {
	h, alice, bob := newHarness(t)
	alicePhone := h.pairApp(alice, auth.KindAndroid)
	bobPhone := h.pairApp(bob, auth.KindAndroid)
	if status, _ := h.register(alicePhone.Token, alicePhone.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusOK {
		t.Fatalf("alice registers: %d", status)
	}
	if status, _ := h.register(bobPhone.Token, bobPhone.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusConflict {
		t.Fatalf("bob took alice's token: %d", status)
	}
	if _, tok := h.pushOf(alicePhone.Device.Id); tok == nil || *tok != fcmToken {
		t.Fatal("alice lost her token to a refused registration")
	}
	pool := h.svc.Push.(*Store).Pool
	idle := h.clock.now.Add(-auth.SessionTTL - time.Hour)
	if _, err := pool.Exec(context.Background(), `update app.devices set last_used_at = $2, created_at = $2 where id = $1`,
		alicePhone.Device.Id, idle); err != nil {
		t.Fatal(err)
	}
	if status, _ := h.register(bobPhone.Token, bobPhone.Device.Id, apitypes.PushPlatformFcm, fcmToken); status != http.StatusOK {
		t.Fatalf("bob after alice's phone lapsed: %d", status)
	}
	if _, tok := h.pushOf(alicePhone.Device.Id); tok != nil {
		t.Fatal("the lapsed device kept the token")
	}
}
