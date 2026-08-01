import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "CNC Render | 3D 작업실";
const description =
  "WebGPU 우선·WebGL 2 폴백으로 동작하는 CNC Render 교육용 3D 작업실과 렌더 진단 화면입니다.";

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
          alt: "CNC Render 3D 작업실과 수직형 머시닝 센터 장면",
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
