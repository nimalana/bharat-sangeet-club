// Wraps what a test renders in the ConfirmProvider, so that a screen that calls `useConfirm()` can ask its question in a test the way it does
// in the portal (where features/shell/components/home.tsx mounts the provider):
//
//   render(<CalendarPage ... />, { wrapper: ConfirmWrapper });          // or: render(withConfirm(<CalendarPage ... />))
//   fireEvent.click(screen.getByRole("button", { name: "Remove" }));
//   fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));   // the Confirm button; "Cancel" says no
import type { ReactNode } from "react";
import { ConfirmProvider } from "../../components/ui/confirm";

export function ConfirmWrapper({ children }: { children: ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}

export const withConfirm = (node: ReactNode) => <ConfirmWrapper>{node}</ConfirmWrapper>;
