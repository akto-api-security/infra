variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-docker-app"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "eastus"
}

variable "vm_name" {
  description = "Name of the virtual machine"
  type        = string
  default     = "vm-docker-app"
}

variable "vm_size" {
  description = "Size of the virtual machine"
  type        = string
  default     = "Standard_D4s_v3" # 4 vCPUs, 16GB RAM for Kafka + services
}

variable "admin_username" {
  description = "Admin username for the VM"
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for VM access (key is installed but port 22 is closed by default)"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "app_port" {
  description = "Application port exposed by docker-compose (data-ingestion-service)"
  type        = number
  default     = 8080
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    Environment = "Development"
    ManagedBy   = "Terraform"
    Project     = "DockerApp"
  }
}

variable "akto_token" {
  description = "Akto Database Abstractor Service Token"
  type        = string
  sensitive   = true
}

variable "azure_connection_string" {
  description = "Azure Binary Storage Connection String"
  type        = string
  sensitive   = true
}

variable "akto_kafka_ip" {
  description = "IP address for Kafka advertised listener (usually VM's private IP)"
  type        = string
  default     = ""
}
