import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import { ApplicationShell } from "@/components/application-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "LessonForge",
  description: "LessonForge lesson-planning application under development.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <WorkspaceNavigation>
            <ApplicationShell>{children}</ApplicationShell>
          </WorkspaceNavigation>
        </AuthProvider>
      </body>
    </html>
  );
}
