import "server-only";

export type DemoUser = { username: string; uid: string; name: string };

/** DEMO_USERS=alex:u-alex:Alex Morgan,jordan:u-jordan:Jordan Lee  (falls back to the single DEMO_USERNAME). */
export function demoUsers(): DemoUser[] {
  const raw = process.env.DEMO_USERS;
  if (!raw) {
    return [{ username: (process.env.DEMO_USERNAME ?? "alex").toLowerCase(), uid: process.env.DEMO_USER_ID ?? "u-alex", name: process.env.DEMO_DISPLAY_NAME ?? "Demo user" }];
  }
  return raw.split(",").map((e) => {
    const [username, uid, name] = e.split(":").map((x) => x.trim());
    return { username: username.toLowerCase(), uid, name: name || username };
  });
}
