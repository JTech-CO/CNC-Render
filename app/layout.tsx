import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "CNC Render | M0 Foundation";
const description =
  "웹 기반 CNC 가공 학습 시뮬레이터의 M0 저장소 경계와 다음 구축 단계를 소개합니다.";

function requestOrigin(host: string, forwardedProtocol: string | null) {
  const firstProtocol = forwardedProtocol?.split(",")[0]?.trim();
  const protocol =
    firstProtocol === "http" || firstProtocol === "https"
      ? firstProtocol
      : host.startsWith("localhost")
        ? "http"
        : "https";

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const socialImageUrl = new URL(
    "/og.png",
    requestOrigin(host, requestHeaders.get("x-forwarded-proto")),
  ).toString();

  return {
    title,
    description,
    applicationName: "CNC Render",
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "CNC Render",
      title,
      description,
      images: [
        {
          url: socialImageUrl,
          width: 1731,
          height: 909,
          alt: "수직 머시닝 센터 개념과 CNC Render 워드마크",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
