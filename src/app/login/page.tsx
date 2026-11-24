import { Suspense } from "react";
import { LoginForm } from "@/components/login/LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <Suspense fallback={<LoginForm next="/" />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const notice =
    params.error === "not-allowed"
      ? "That account is signed in, but it is not on the list of accounts that can use this application."
      : undefined;
  return <LoginForm next={params.next ?? "/"} notice={notice} />;
}
