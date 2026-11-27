// En Cloudflare la credencial de servicio es interna del Worker (nunca sale a la red).
export async function verifyServiceCredential(_projectUrl: string, authorization: string): Promise<boolean> {
  return authorization === "Bearer " + (globalThis as any).Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
