package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// DeleteUser sends DELETE /user_management/users/{id}; WorkOS's 404 (a
// user already deleted, a retry after a lost answer) is success, and any
// other failure is an error for the sweep to retry.
func TestDeleteUser(t *testing.T) {
	cases := map[int]bool{http.StatusOK: true, http.StatusNoContent: true, http.StatusNotFound: true, http.StatusServiceUnavailable: false}
	for status, ok := range cases {
		var method, path string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			method, path = r.Method, r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"message":"m"}`))
		}))
		w := NewWorkOS("sk_test_key", "client_test", "https://api.example.invalid/auth/callback")
		w.client.Endpoint = srv.URL
		err := w.DeleteUser(context.Background(), "user_01")
		srv.Close()
		if (err == nil) != ok {
			t.Errorf("status %d: err %v", status, err)
		}
		if method != http.MethodDelete || path != "/user_management/users/user_01" {
			t.Errorf("status %d: sent %s %s", status, method, path)
		}
	}
}
