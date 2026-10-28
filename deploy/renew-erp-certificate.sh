#!/usr/bin/env bash
set -euo pipefail

# Certbot 更新本站证书后，让 Nginx 重新读取证书文件。
case " ${RENEWED_DOMAINS:-} " in
  *" bag.sshapi.cn "*)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    ;;
esac
