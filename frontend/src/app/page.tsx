import { AuthPanel } from "@/components/auth-panel";
import { AuthProvider } from "@/components/auth-provider";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-50 p-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          LessonForge
        </h1>
        <p className="mt-3 text-slate-600">
          A place to prepare and review lesson plans.
        </p>
      </header>
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>
    </main>
  );
}
