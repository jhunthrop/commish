"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";

/**
 * The home-page answer to "my friend invited me, now what": paste the invite link or code and
 * go. No API call here; it routes to the invite landing page, which owns the join itself, so
 * there is exactly one join path however you arrive.
 */
export function JoinLeagueEntry() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const code = value.trim().split("/").filter(Boolean).pop() ?? "";

  const go = (event: React.FormEvent): void => {
    event.preventDefault();
    if (code.length > 0) router.push(`/app/join/${encodeURIComponent(code)}`);
  };

  return (
    <form onSubmit={go} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Input
          label="Invite link or code"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste what your commissioner sent you"
        />
      </div>
      <Button type="submit" variant="secondary" disabled={code.length === 0}>
        Join a league
      </Button>
    </form>
  );
}
