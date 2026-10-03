// Inside the shell: navigation stays usable while a page's data loads. Kept out of the root so that redirects from
// "/" and the onboarding stay real HTTP redirects instead of streamed client redirects.
export default function Loading() {
  return (
    <div aria-busy="true" className="page-loading">
      <p role="status" className="muted">
        正在读取…
      </p>
    </div>
  );
}
