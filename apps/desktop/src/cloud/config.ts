export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseEnvironment = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

// Missing configuration keeps cloud features optional for local-only desktop use.
// Errors deliberately exclude the supplied values.
export function readSupabaseConfig(env: SupabaseEnvironment): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey) {
    throw new Error("Supabase URL과 Publishable key를 모두 설정하세요.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Supabase URL 형식을 확인하세요.");
  }
  const localHttp = parsedUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
  if (
    (parsedUrl.protocol !== "https:" && !localHttp) ||
    parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    throw new Error("Supabase 프로젝트 URL을 입력하세요. 원격 연결에는 HTTPS가 필요합니다.");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("Supabase Publishable key를 사용하세요. 비밀키는 앱에 넣을 수 없습니다.");
  }
  return { url: parsedUrl.origin, publishableKey };
}
