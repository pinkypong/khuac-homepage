"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export class MapErrorBoundary extends Component<
  { children: ReactNode; onShowAlbum: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[map/render]", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <MapUnavailable onShowAlbum={this.props.onShowAlbum} />;
  }
}

export function MapUnavailable({onShowAlbum}: {onShowAlbum: () => void}) {
  return <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 bg-neutral-100 p-8 text-center">
    <h2 className="text-xl font-semibold">지도를 불러오지 못했습니다</h2>
    <p className="max-w-sm text-sm text-neutral-600">잠시 후 다시 시도해주세요. 앨범은 계속 볼 수 있습니다.</p>
    <div className="flex gap-3"><button className="border border-neutral-300 bg-white px-4 py-3" onClick={()=>window.location.reload()}>새로고침</button><button className="bg-[#5b1a23] px-4 py-3 text-white" onClick={onShowAlbum}>앨범 보기</button></div>
  </div>;
}
