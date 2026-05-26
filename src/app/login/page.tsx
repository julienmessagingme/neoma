import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image
            src="/logos/neoma.png"
            alt="Neoma Business School"
            width={210}
            height={97}
            className="h-20 w-auto object-contain"
            priority
            unoptimized
          />
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
