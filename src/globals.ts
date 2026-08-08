export type webOSLaunchParams = Record<string, unknown>;

declare global {
  interface Window {
    launchParams?: string | webOSLaunchParams;
    __ytaf_debug__?: boolean;
  }

  interface Document {
    addEventListener(
      eventName: 'webOSRelaunch',
      listener: (evt: CustomEvent<webOSLaunchParams>) => void,
      useCapture?: boolean
    ): void;
  }
}
