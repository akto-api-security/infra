terraform {
  required_version = ">= 1.5.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4.0"
    }

    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 7.0.0"
    }
  }
}
