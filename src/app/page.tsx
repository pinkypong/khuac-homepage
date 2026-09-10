import { redirect } from "next/navigation";

// The map is the app: everything (albums, search, upload) hangs off it.
export default function Home() {
  redirect("/map");
}
