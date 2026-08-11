# Privacy

The application loads YouTube from `https://www.youtube.com`. Authentication,
playback and YouTube telemetry are therefore governed by YouTube's services.

SponsorBlock is disabled by default. If enabled, the application sends the
first four hexadecimal characters of a SHA-256 hash of each watched YouTube
video ID to `https://sponsor.ajay.app`. The service also receives ordinary HTTP
metadata such as the public IP address and User-Agent. Disabling SponsorBlock
stops these requests.

The application does not contain its own analytics, advertising telemetry,
proxy service, remote command channel or file-upload mechanism.
