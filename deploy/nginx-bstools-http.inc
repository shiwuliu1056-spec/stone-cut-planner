# Additive include inside the existing HTTP server; no other route is altered.
location = /bstools {
    access_log /var/log/nginx/bstools-access.log bstools_safe;
    return 308 https://cacci.cn/bstools/;
}
location ^~ /bstools/ {
    access_log /var/log/nginx/bstools-access.log bstools_safe;
    return 308 https://cacci.cn$request_uri;
}
