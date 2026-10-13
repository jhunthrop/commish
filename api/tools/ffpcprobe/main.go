// ffpcprobe signs in to FFPC through the api's own client, the way a
// connect does, and prints only what an operator may see: statuses, the
// names of the cookies FFPC set, the league count, and the refusal's
// reason. The email and password come from FFPC_USER and FFPC_PASS and
// are never printed. Run it yourself:
//
//	FFPC_USER=you@example.com FFPC_PASS='...' go run ./tools/ffpcprobe
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

func main() {
	user, pass := os.Getenv("FFPC_USER"), os.Getenv("FFPC_PASS")
	if user == "" || pass == "" {
		fmt.Println("set FFPC_USER and FFPC_PASS in the environment (they are never printed)")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := ffpc.New()
	started := time.Now()
	jar, leagues, err := client.SignIn(ctx, user, pass)
	fmt.Printf("took %s\n", time.Since(started).Round(time.Millisecond))
	switch {
	case errors.Is(err, ffpc.ErrBadSignIn):
		fmt.Println("result: FFPC said the email or password is wrong (ErrBadSignIn)")
	case errors.Is(err, ffpc.ErrUnexpected):
		fmt.Printf("result: unexpected answer (ErrUnexpected): %v\n", err)
	case err != nil:
		fmt.Printf("result: error: %v\n", err)
	default:
		names := make([]string, 0, len(jar))
		for name := range jar {
			names = append(names, name)
		}
		sort.Strings(names)
		fmt.Printf("result: signed in; cookies set: %v; leagues on My Teams: %d\n", names, len(leagues))
		for _, l := range leagues {
			fmt.Printf("  league %q team %q\n", l.Name, l.TeamName)
		}
	}
}
