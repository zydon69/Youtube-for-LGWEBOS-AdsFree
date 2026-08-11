export type webOSLaunchParams = Record<string, unknown>;

declare global {
  interface Window {
    launchParams?: string | webOSLaunchParams;
    __ytaf_debug__?: boolean;
    navigate?: (direction: 'left' | 'right' | 'up' | 'down') => void;
    __spatialNavigation__?: { keyMode: string };
    ytaf_showOptionsPanel?: (visible?: boolean) => void;
  }

  interface Document {
    addEventListener(
      eventName: 'webOSRelaunch',
      listener: (evt: CustomEvent<webOSLaunchParams>) => void,
      useCapture?: boolean
    ): void;
  }
}
