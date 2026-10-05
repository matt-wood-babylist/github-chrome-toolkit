// esbuild's `text` loader turns these imports into inlined strings.
declare module '*.html' {
  const content: string
  export default content
}
