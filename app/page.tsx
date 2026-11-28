import Home from "../features/shell/components/home";
import { loadPublicConcerts } from "../lib/public-concerts";

// The signed-out page is rendered on the server, with the public concert list
// inside it, and rebuilt at most every five minutes. The list is read with the
// anon key and only what the public concert policy exposes. It carries no
// signed links: those are requested when a visitor clicks Watch.
// Must be a literal for Next to read it: 300 seconds, as in lib/public-concerts.ts.
export const revalidate = 300;

export default async function Page() {
  const publicConcerts = await loadPublicConcerts({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return <Home publicConcerts={publicConcerts} />;
}
