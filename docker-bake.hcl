# Builds the Noodle Gallery server image: upstream's server/Dockerfile from this
# branch's source, then Dockerfile.custom on top of it. See docs/custom-fork.md.
#
#   docker buildx bake --set '*.platform=linux/arm64' custom

variable "IMAGE" {
  default = "ghcr.io/bierdav/gallery-server"
}

target "upstream" {
  context    = "."
  dockerfile = "server/Dockerfile"
  # Lets upstream's plugin build fetch its extism js-pdk without GitHub API rate limits.
  secret = ["id=github_token,env=GITHUB_TOKEN"]
}

target "custom" {
  context    = "."
  dockerfile = "Dockerfile.custom"
  contexts = {
    gallery-server = "target:upstream"
  }
  tags = ["${IMAGE}:build"]
}

group "default" {
  targets = ["custom"]
}
