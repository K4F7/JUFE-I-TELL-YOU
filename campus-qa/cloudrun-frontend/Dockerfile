FROM nginx:1.25-alpine

COPY cloudrun-frontend/default.conf /etc/nginx/conf.d/default.conf
COPY frontend /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
