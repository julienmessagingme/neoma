import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center mb-6">Neoma Dashboard</h1>
        <LoginForm />
      </div>
    </main>
  );
}
