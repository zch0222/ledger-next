#!/bin/sh
# Creates .env from .env.example with fresh random secrets (MySQL passwords, session secret, channel master key).
# Secrets come from /dev/urandom, are never printed, and the file is created with mode 600; an existing file is
# never overwritten (credentials of an initialised database and the channel master key cannot simply be replaced).
#   sh scripts/setup-env.sh [--app-url https://ledger.example] [--output .env]
#   docker compose -f compose.tools.yaml run --rm setup-env [same options]      (only Docker on the host)
set -eu
umask 077

usage() {
  cat <<'EOF'
用法: sh scripts/setup-env.sh [--app-url URL] [--output 文件] [--template 文件]
  --app-url URL    对外访问地址，生产环境用 https://（默认沿用模板中的 http://localhost:3000）
  --output 文件    生成的配置文件（默认 .env；已存在时拒绝覆盖）
  --template 文件  配置模板（默认 .env.example）
EOF
}
die() { printf '错误: %s\n' "$1" >&2; exit 1; }

out=.env template=.env.example app_url=
while [ $# -gt 0 ]; do
  case $1 in
    --app-url) [ $# -ge 2 ] || die '--app-url 需要一个值'; app_url=$2; shift 2 ;;
    --app-url=*) app_url=${1#*=}; shift ;;
    -o|--output) [ $# -ge 2 ] || die '--output 需要一个值'; out=$2; shift 2 ;;
    --output=*) out=${1#*=}; shift ;;
    --template) [ $# -ge 2 ] || die '--template 需要一个值'; template=$2; shift 2 ;;
    --template=*) template=${1#*=}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "未知参数: $1" ;;
  esac
done

[ -f "$template" ] || die "找不到模板 $template（请在仓库根目录执行）"
if [ -e "$out" ] || [ -L "$out" ]; then
  die "$out 已存在，未做任何修改。重新生成会使已初始化的 MySQL 账号和已加密的渠道凭据失效；确需重建请先备份并移走它，或用 --output 生成到新文件后手工合并"
fi
case $app_url in
  '') ;;
  *[[:space:]]*) die '--app-url 不能包含空白字符' ;;
  https://?*) app_url=${app_url%/} ;;
  http://localhost*|http://127.0.0.1*) app_url=${app_url%/} ;;
  http://?*) app_url=${app_url%/}; printf '警告: %s 不是 HTTPS；生产环境必须使用 https:// 地址\n' "$app_url" >&2 ;;
  *) die '--app-url 必须以 http:// 或 https:// 开头' ;;
esac
[ -r /dev/urandom ] || die '无法读取 /dev/urandom'
command -v base64 >/dev/null 2>&1 || die '需要 base64 命令（coreutils）'

# hex N: N random bytes as 2N hex characters (URL-safe, so it can sit inside DATABASE_URL).
hex() { od -An -v -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
# b64 N: N random bytes, standard base64 on one line.
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

mysql_password=$(hex 32)
mysql_root_password=$(hex 32)
auth_secret=$(hex 32)
master_key=$(b64 32)
for value in "$mysql_password" "$mysql_root_password" "$auth_secret"; do [ ${#value} -eq 64 ] || die '随机数生成失败'; done
[ ${#master_key} -eq 44 ] || die '随机数生成失败'

render() {
  db=ledger user=ledger cr=$(printf '\r')
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%"$cr"}
    case $line in
      MYSQL_DATABASE=*) db=${line#*=}; printf '%s\n' "$line" ;;
      MYSQL_USER=*) user=${line#*=}; printf '%s\n' "$line" ;;
      MYSQL_PASSWORD=*) printf 'MYSQL_PASSWORD=%s\n' "$mysql_password" ;;
      MYSQL_ROOT_PASSWORD=*) printf 'MYSQL_ROOT_PASSWORD=%s\n' "$mysql_root_password" ;;
      BETTER_AUTH_SECRET=*) printf 'BETTER_AUTH_SECRET=%s\n' "$auth_secret" ;;
      LEDGER_ENCRYPTION_KEYS=*) printf 'LEDGER_ENCRYPTION_KEYS=k1:%s\n' "$master_key" ;;
      DATABASE_URL=*) printf 'DATABASE_URL=mysql://%s:%s@localhost:3306/%s\n' "$user" "$mysql_password" "$db" ;;
      APP_URL=*) if [ -n "$app_url" ]; then printf 'APP_URL=%s\n' "$app_url"; else printf '%s\n' "$line"; fi ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$template"
}
content=$(render)

for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD BETTER_AUTH_SECRET LEDGER_ENCRYPTION_KEYS; do
  printf '%s\n' "$content" | grep -q "^$key=." || die "模板 $template 缺少 $key"
done
if printf '%s\n' "$content" | grep -v '^[[:space:]]*#' | grep -q '<generated>'; then
  die "模板 $template 中仍有未替换的 <generated> 占位符"
fi

# noclobber: the file is created exclusively, so a concurrent run can never replace it.
(set -C; printf '%s\n' "$content" > "$out") 2>/dev/null || die "无法创建 $out（可能已存在）"
chmod 600 "$out"
# Run as root in the toolbox container on a Linux host: hand the file to the checkout's owner so host-side
# Compose can read it. Docker Desktop mounts map ownership themselves.
if [ "$(id -u)" = 0 ]; then
  owner=$(stat -c '%u:%g' "$(dirname -- "$out")" 2>/dev/null || true)
  case $owner in ''|0:*) ;; *) chown "$owner" "$out" 2>/dev/null || true ;; esac
fi

printf '已创建 %s（权限 600）：MYSQL_PASSWORD、MYSQL_ROOT_PASSWORD、BETTER_AUTH_SECRET、LEDGER_ENCRYPTION_KEYS 为新生成的随机值，未在此输出。\n' "$out"
printf '下一步：按 README「环境变量」检查 APP_URL 等配置；把 BETTER_AUTH_SECRET 与 LEDGER_ENCRYPTION_KEYS 另行备份（与数据库备份分开存放）。\n'
