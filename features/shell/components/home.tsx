"use client";

import { ToastProvider } from "../../../components/ui/toast";
import type { PublicConcert } from "../../../lib/public-concerts";
import { Portal } from "./portal";

export default function Home(props: { publicConcerts?: PublicConcert[] | null }) {
  return <ToastProvider><Portal {...props} /></ToastProvider>;
}
