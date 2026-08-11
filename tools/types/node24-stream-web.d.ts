// happy-dom 20.11 declares the WHATWG default source split introduced in
// @types/node 25. Node 24 exposes the same runtime contract through the older
// UnderlyingSource name, so keep the Node 24 type baseline and add the missing
// structural alias locally instead of disabling dependency type checking.
declare module 'stream/web' {
  interface UnderlyingDefaultSource<R = any> {
    cancel?: UnderlyingSourceCancelCallback;
    pull?: (
      controller: ReadableStreamDefaultController<R>
    ) => void | PromiseLike<void>;
    start?: (controller: ReadableStreamDefaultController<R>) => any;
    type?: undefined;
  }
}
