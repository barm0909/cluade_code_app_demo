output "public_ip" {
  description = "WebサーバーのグローバルIP(Elastic IP)"
  value       = aws_eip.web.public_ip
}

output "url" {
  description = "アプリのURL"
  value       = "http://${aws_eip.web.public_ip}"
}

output "ssh_command" {
  description = "SSH接続コマンド"
  value       = "ssh ec2-user@${aws_eip.web.public_ip}"
}
