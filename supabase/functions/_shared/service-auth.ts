// A project may have more than one valid service credential. Never authorize a
// JWT by decoding its role: let this project's protected Auth API verify it.
export async function verifyServiceCredential(projectUrl: string, authorization: string): Promise<boolean> {
  if (!/^Bearer \S+$/.test(authorization)) return false;
  const credential = authorization.slice(7);
  try {
    const response = await fetch(projectUrl + "/auth/v1/admin/users?page=1&per_page=1", {
      method: "GET", redirect: "error",
      headers: { Authorization: authorization, apikey: credential },
      signal: AbortSignal.timeout(10000),
    });
    // Only the protected endpoint's status is needed. Do not read user records.
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}
