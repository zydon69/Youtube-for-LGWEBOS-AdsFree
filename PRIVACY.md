# Privacy

The application loads YouTube from `https://www.youtube.com`. Authentication,
playback and YouTube telemetry are therefore governed by YouTube's services.

SponsorBlock is disabled by default. If enabled, the application sends the
first four hexadecimal characters of a SHA-256 hash of each watched YouTube
video ID to `https://sponsor.ajay.app`. Only the enabled segment categories are
requested. The service also receives ordinary HTTP metadata such as the public
IP address and User-Agent. The webOS User-Agent can include the TV model,
firmware version and network mode: YouTube receives it during normal use, while
SponsorBlock receives it only after SponsorBlock is enabled. Disabling
SponsorBlock prevents new requests; in-flight requests are aborted on engines
that support `AbortController`, and their result is ignored on older engines.

The reviewed source at release time contains no application-owned analytics,
advertising telemetry, proxy service, remote command channel or file-upload
mechanism. YouTube itself remains a remote web application and can change its
own behavior independently of this package.

Release SBOM and provenance files contain source commit/tree hashes, dependency
and tool versions, build mode and artifact hashes. They contain no TV, account,
network, playback or other end-user data.
