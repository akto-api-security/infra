# Resource Group
resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      tags,
    ]
  }
}

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.vm_name}"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      tags,
    ]
  }
}

# Subnet for VMs
resource "azurerm_subnet" "vm_subnet" {
  name                 = "subnet-vm"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

# Subnet for Application Gateway
resource "azurerm_subnet" "gateway_subnet" {
  name                 = "subnet-gateway"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

# Network Security Group for VM
resource "azurerm_network_security_group" "vm_nsg" {
  name                = "nsg-${var.vm_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  # SSH Port 22 - CLOSED by default for security
  # To enable SSH access, manually add NSG rule via Azure Portal or CLI
  # The VM has SSH key configured and ready to use

  security_rule {
    name                       = "AppPort"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = tostring(var.app_port)
    source_address_prefix      = "10.0.2.0/24" # Only from gateway subnet
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "GuardrailsPort"
    priority                   = 1005
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "9091"
    source_address_prefix      = "10.0.2.0/24" # Only from gateway subnet
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "Kafka"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "9092"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowInternalSubnet"
    priority                   = 1004
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "10.0.1.0/24" # Allow from VM subnet
    destination_address_prefix = "*"
  }
}

# Public IP for Application Gateway
resource "azurerm_public_ip" "gateway_pip" {
  name                = "pip-gateway-${var.vm_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

# Network Interface for VM
resource "azurerm_network_interface" "vm_nic" {
  name                = "nic-${var.vm_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.vm_subnet.id
    private_ip_address_allocation = "Dynamic"
  }
}

# Associate NSG with NIC
resource "azurerm_network_interface_security_group_association" "vm_nsg_assoc" {
  network_interface_id      = azurerm_network_interface.vm_nic.id
  network_security_group_id = azurerm_network_security_group.vm_nsg.id
}

# Virtual Machine
resource "azurerm_linux_virtual_machine" "main" {
  name                = var.vm_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.vm_size
  admin_username      = var.admin_username
  tags                = var.tags

  network_interface_ids = [
    azurerm_network_interface.vm_nic.id,
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    app_port                  = var.app_port
    akto_token               = var.akto_token
    azure_connection_string  = var.azure_connection_string
    akto_kafka_ip            = var.akto_kafka_ip != "" ? var.akto_kafka_ip : azurerm_network_interface.vm_nic.private_ip_address
    docker_compose_content   = file("${path.module}/../docker-compose/docker-compose-agentic-poc.yml")
    data_ingestion_env       = templatefile("${path.module}/../docker-compose/data-ingestion-docker.env", {})
    account_job_executor_env = templatefile("${path.module}/../docker-compose/docker-account-job-executor.env", {
      akto_token              = var.akto_token
      azure_connection_string = var.azure_connection_string
    })
    mini_runtime_env = templatefile("${path.module}/../docker-compose/docker-mini-runtime.env", {
      akto_token = var.akto_token
    })
    guardrails_kafka_env = templatefile("${path.module}/../docker-compose/docker-guardrails-service-kafka.env", {
      akto_token = var.akto_token
    })
    guardrails_service_env = templatefile("${path.module}/../docker-compose/docker-guardrails-service.env", {
      akto_token = var.akto_token
    })
  }))

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      custom_data,
      tags,
    ]
  }
}

# Application Gateway
resource "azurerm_application_gateway" "main" {
  name                = "appgw-${var.vm_name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = var.tags

  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = 1
  }

  ssl_policy {
    policy_type = "Predefined"
    policy_name = "AppGwSslPolicy20220101"
  }

  gateway_ip_configuration {
    name      = "gateway-ip-config"
    subnet_id = azurerm_subnet.gateway_subnet.id
  }

  frontend_port {
    name = "http-port"
    port = 80
  }

  frontend_ip_configuration {
    name                 = "frontend-ip-config"
    public_ip_address_id = azurerm_public_ip.gateway_pip.id
  }

  backend_address_pool {
    name = "backend-pool-data-ingestion"
    ip_addresses = [
      azurerm_network_interface.vm_nic.private_ip_address
    ]
  }

  backend_address_pool {
    name = "backend-pool-guardrails"
    ip_addresses = [
      azurerm_network_interface.vm_nic.private_ip_address
    ]
  }

  backend_http_settings {
    name                  = "http-settings-data-ingestion"
    cookie_based_affinity = "Disabled"
    port                  = var.app_port
    protocol              = "Http"
    request_timeout       = 60
    probe_name            = "health-probe-data-ingestion"
  }

  backend_http_settings {
    name                  = "http-settings-guardrails"
    cookie_based_affinity = "Disabled"
    port                  = 9091
    protocol              = "Http"
    request_timeout       = 60
    probe_name            = "health-probe-guardrails"
  }

  probe {
    name                = "health-probe-data-ingestion"
    protocol            = "Http"
    path                = "/"
    host                = "127.0.0.1"
    interval            = 30
    timeout             = 30
    unhealthy_threshold = 3

    match {
      status_code = ["200-499"]
    }
  }

  probe {
    name                = "health-probe-guardrails"
    protocol            = "Http"
    path                = "/"
    host                = "127.0.0.1"
    interval            = 30
    timeout             = 30
    unhealthy_threshold = 3

    match {
      status_code = ["200-499"]
    }
  }

  http_listener {
    name                           = "http-listener"
    frontend_ip_configuration_name = "frontend-ip-config"
    frontend_port_name             = "http-port"
    protocol                       = "Http"
  }

  request_routing_rule {
    name               = "routing-rule"
    rule_type          = "PathBasedRouting"
    http_listener_name = "http-listener"
    url_path_map_name  = "path-map"
    priority           = 100
  }

  url_path_map {
    name                               = "path-map"
    default_backend_address_pool_name  = "backend-pool-data-ingestion"
    default_backend_http_settings_name = "http-settings-data-ingestion"

    path_rule {
      name                       = "guardrails-rule"
      paths                      = ["/api/validate/*"]
      backend_address_pool_name  = "backend-pool-guardrails"
      backend_http_settings_name = "http-settings-guardrails"
    }
  }

  depends_on = [
    azurerm_linux_virtual_machine.main
  ]
}
