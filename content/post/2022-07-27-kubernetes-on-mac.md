---
date: "2022-07-27T00:00:00Z"
loc_date: 27 июля 2022
slug: kubernetes-on-mac
title: Хочется странного, или запускаем кубернеты на macOS
---

Летнее утро началось с ласковых лучей солнца, оторвавших меня от некрепкого сна.
Понежевшись в его лучах (а также лучах экрана смартфона) я отправился на кухню и
начал готовить незамысловатый завтрак. В очередной раз на этой неделе меня ждали
разогретые в микроволновке макароны с сосисками. Задумчиво пережевывая простое
блюдо, лишенное сильных гастрономических качеств, я понял, что надо как-то
растрясти обыденность и сделать что-то странное. Например, запустить Kubernetes
на своем макбуке.

Зачем? Конечно же, потому что это круто. Но помимо этого я прочитал комментарий
на оранжевом сайте, что люди запускают `kube-apiserver` отдельно, чтобы
использовать такие концепты куберов, как reconcilliation loop и декларативную
модель, но не для запуска приложений, а для каких-то других целей. Доказательств
этому я в интернете не нашел, поэтому решил, что надо послужить примером.

<!--more-->

# Шаг 1: раздобываем бинари

Задача-минимум на сегодня - сделать так, чтобы `kubectl get pods`, натравленный
на поднятый `kube-apiserver` не падал с ошибкой, а возвращал ответ, что подов в
кластере нет. Для этого нам потребуется `kube-apiserver` и `etcd` в качестве
бекенда, хранящего его данные. Если с последним нет никаких проблем, и его можно
скачать с его [страницы релизов на
GitHub](https://github.com/etcd-io/etcd/releases/tag/v3.5.2)[^1], то с
`kube-apiserver` есть нюанс: по какой-то неведомой для меня причине официальных
бинарников для macOS не публикуется, так что надо собрать их самим. Скачиваем
репозиторий `kubernetes` в соседнюю папку, делаем `git checkout v1.23.4`, и
незамысловато пишем `make kube-apiserver`[^2]. Через пару минут из папки
`_output/bin/` можно забирать наш исполняемый файл.

Эти и все последующие бинари я буду складывать в папку `bin` в каталоге, в
котором мы играемся.

На данном этапе в этой папке должны быть `etcd`, `etcdctl`, `kube-apiserver`.

# Шаг 2: Запускаем etcd

Когда надо запускать одну и ту же команду с охапкой аргументов, я предпочитаю
создать примитивный shell скрипт, который состоит из одного вызова. Это
позволяет избежать излишней нагрузки на палец и на стрелку вверх в терминале.

Чтобы понять, какие аргументы нам нужны, попробуем просто запустить `etcd`, как
он есть:

```bash
kubernetes-apiserver-mac $ bin/etcd

<snip>

{"level":"info","ts":"2022-07-27T14:32:38.003+0300","caller":"embed/etcd.go:308","msg":"starting an etcd server","etcd-version":"3.5.2","git-sha":"99018a77b","go-version":"go1.16.3","go-os":"darwin","go-arch":"amd64","max-cpu-set":8,"max-cpu-available":8,"member-initialized":true,"name":"default","data-dir":"default.etcd","wal-dir":"","wal-dir-dedicated":"","member-dir":"default.etcd/member","force-new-cluster":false,"heartbeat-interval":"100ms","election-timeout":"1s","initial-election-tick-advance":true,"snapshot-count":100000,"snapshot-catchup-entries":5000,"initial-advertise-peer-urls":["http://localhost:2380"],"listen-peer-urls":["http://localhost:2380"],"advertise-client-urls":["http://localhost:2379"],"listen-client-urls":["http://localhost:2379"],"listen-metrics-urls":[],"cors":["*"],"host-whitelist":["*"],"initial-cluster":"","initial-cluster-state":"new","initial-cluster-token":"","quota-size-bytes":2147483648,"pre-vote":true,"initial-corrupt-check":false,"corrupt-check-time-interval":"0s","auto-compaction-mode":"periodic","auto-compaction-retention":"0s","auto-compaction-interval":"0s","discovery-url":"","discovery-proxy":"","downgrade-check-interval":"5s"}

<snip>

{"level":"info","ts":"2022-07-27T14:32:38.155+0300","caller":"embed/etcd.go:553","msg":"cmux::serve","address":"127.0.0.1:2380"}

<snip>

{"level":"info","ts":"2022-07-27T14:33:55.859+0300","caller":"embed/serve.go:140","msg":"serving client traffic insecurely; this is strongly discouraged!","address":"127.0.0.1:2379"}
```

Похоже, что без каких-либо аргументов etcd запускается, создает директорию
`etcd.default`, запускается как реплика с именем `default`, слушает на порту
`2379`, и делает это по простому HTTP. Вопрос с CA мы решим позже, а пока что
поменяем папку, в которую кладутся данные и имя реплики:

```bash
#!/bin/sh
# etcd.sh

# exec allows to avoid extra shell process existing for no reason.
exec etcd \
  --name s1 \
  --data-dir=etcd-data
```

Теперь из спортивного интереса попробуем подключиться к нашему новорожденному
кластеру с помощью `etcdctl` (так как мы запускаемся с небезопасными
станадртными параметрами, никаких дополнительных флагов чтобы найти базу
команда не просит):

```bash
kubernetes-apiserver-mac $ bin/etcdctl member list

8e9e05c52164694d, started, s1, http://localhost:2380, http://localhost:2379, false


kubernetes-apiserver-mac $ bin/etcdctl put a b

OK

bin/etcdctl get 'a'

a
b
```

Отлично, кластер работает. Можно его смело выключать и удалять папку с
данными.

По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/9d221e580e11f961c6012ff8031984de12e39920)

# Шаг 3: Дружим etcd и kube-apiserver

Не будем останавливаться на успешно выданной базе, попробуем теперь запустить
`kube-apiserver`.

```bash
kubernetes-apiserver-mac $ bin/kube-apiserver

W0727 14:44:22.375955   95614 services.go:37] No CIDR for service cluster IPs specified. Default value which was 10.0.0.0/24 is deprecated and will be removed in future releases. Please specify it using --service-cluster-ip-range on kube-apiserver.
E0727 14:44:22.581038   95614 run.go:74] "command failed" err="error creating self-signed certificates: mkdir /var/run/kubernetes: permission denied"
```

Увы, но с первого пинка ничего не завелось. Нам сразу пожаловались на диапазон
внутренних IP-адресов для объектов `Service` и, что критичнее, кубернетес не
смог положить сертификаты в папку, так как он привык к Linux, и не создан для
той ереси, которую мы сейчас творим. Время изучать `--help`:

```bash
      --service-account-key-file stringArray
                File containing PEM-encoded x509 RSA or ECDSA private or public keys, used to verify ServiceAccount tokens. The specified file can contain multiple keys, and the flag can be specified multiple times with different
                files. If unspecified, --tls-private-key-file is used. Must be specified when --service-account-signing-key is provided
      --service-account-signing-key-file string
                Path to the file that contains the current private key of the service account token issuer. The issuer will sign issued ID tokens with this private key.
      --service-account-issuer stringArray
                Identifier of the service account token issuer. The issuer will assert this identifier in "iss" claim of issued tokens. This value is a string or URI. If this option is not a valid URI per the OpenID Discovery 1.0
                spec, the ServiceAccountIssuerDiscovery feature will remain disabled, even if the feature gate is set to true. It is highly recommended that this value comply with the OpenID spec:
                https://openid.net/specs/openid-connect-discovery-1_0.html. In practice, this means that service-account-issuer must be an https URL. It is also highly recommended that this URL be capable of serving OpenID discovery
                documents at {service-account-issuer}/.well-known/openid-configuration. When this flag is specified multiple times, the first is used to generate tokens and all are used to determine which issuers are accepted.
      --api-audiences strings
                Identifiers of the API. The service account token authenticator will validate that tokens used against the API are bound to at least one of these audiences. If the --service-account-issuer flag is configured and this
                flag is not, this field defaults to a single element list containing the issuer URL.
      --cert-dir string
                The directory where the TLS certs are located. If --tls-cert-file and --tls-private-key-file are provided, this flag will be ignored. (default "/var/run/kubernetes")
      --tls-cert-file string
                File containing the default x509 Certificate for HTTPS. (CA cert, if any, concatenated after server cert). If HTTPS serving is enabled, and --tls-cert-file and --tls-private-key-file are not provided, a self-signed
                certificate and key are generated for the public address and saved to the directory specified by --cert-dir.
      --tls-private-key-file string
                File containing the default x509 private key matching --tls-cert-file.
      --etcd-servers strings
                List of etcd servers to connect with (scheme://ip:port), comma separated.
```

Да, это вам не `etcd`, `kube-apiserver` куда требовательнее к тому, что ему
нужно для работы даже в минимальной комплектации. Методом проб и ошибок получаем
минимальный набор аргументов, чтобы угодить аписерверу:

```bash
#!/bin/sh
# kube-apiserver.sh

CERT_DIR=certs

exec bin/kube-apiserver \
      --api-audiences=https://127.0.0.1:6443 \
      --service-account-key-file="$CERT_DIR/sa.pub" \
      --service-account-signing-key-file="$CERT_DIR/sa.key" \
      --service-account-issuer=https://kubernetes.default.svc.cluster.local \
      --cert-dir="$CERT_DIR" \
      --etcd-servers="http://127.0.0.1:2379"
```

К сожалению, если основные TLS сертификаты для работы сервера еще генерируются
автоматически, то для подписи токенов `ServiceAccount` ключ надо создать нам
самостоятельно. Для этого сразу заведем вспомогательный скрипт `gen-certs.sh`
(название намекает, что у него появится еще несколько функций):

```bash
#!/bin/env bash
# gen-certs.sh

CERT_DIR=certs

function gen_keypair() {
    local name=$1

    local key_file="$CERT_DIR/$name.key"
    local pub_file="$CERT_DIR/$name.pub"

    test -f "$key_file" || openssl genrsa -out "$key_file" 2048
    test -f "$pub_file" || openssl rsa -in "$key_file" -pubout -out "$pub_file"
}

mkdir -p "$CERT_DIR"

gen_keypair sa
```

Теперь можно и запустить apiserver:

```bash
kubernetes-apiserver-mac $ sh gen-certs.sh && sh kube-apiserver.sh
```

Вывод команды совершенно неинтересный, но сервер-таки успешно запустился!

```bash
kubernetes-apiserver-mac $ curl https://localhost:6443 --cacert certs/apiserver.crt

{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "Unauthorized",
  "reason": "Unauthorized",
  "code": 401
}
```

Сервер, конечно, запустился, но нас он авторизовывать не хочет. К сожалению,
никакие мои эксперименты не дали способа запустить аписервер в максимально
небезопасном режиме, разрешающем кому угодно ходить в кластер без какой-либо
аутентификации и авторизации: можно либо отключить первое, либо второе, но при
попытке отключить все сервер отказывается, и насильно отменяет анонимный доступ.
Похоже, что время взять генерацию сертификатов на себя и выписать себе права для
админского доступа по-честному.


По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/0c4ffdd1a832f93beae060af1c428ca4f879568a)


# Шаг 4: Создаем сертификаты для доступа в кластер

Настало время дополнить наш скрипт по генерации публичных ключей созданием
иерархии сертификатов.

## Маленький рефакторинг

Также воспользуемся случаем, и вынесем те переменные, что
мы используем в разных скриптах (путь к папке `bin`, папке с сертификатами,
имена сертификатов) в отдельный скрипт под названием `config`, который только
экспортирует переменные:

```bash
# config

# certificate settings
export CERT_DIR=certs

export SA_NAME="sa"
export SA_PUB="$CERT_DIR/$SA_NAME.pub"
export SA_KEY="$CERT_DIR/$SA_NAME.key"

# binary file locations
export BIN=bin
export ETCD="$BIN/etcd"
export ETCDCTL="$BIN/etcdctl"
export KUBE_APISERVER="$BIN/kube-apiserver"
```

По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/190595bebb141f7a2ba8f627b0c3cf974e7eecf1)

## Иерархия сертификатов

API kube-apiserver авторизует пользователя по его клиентскому сертификату,
смотря на Canonical Name (CN) сертификата чтобы определить имя пользователя, и
на Organization (O), чтобы определить группы (в случае RBAC это
ClusterRole[^3]), в которых он состоит. Это означает, что нам достаточно
выписать от имени корневого CA сертификат с правильным Subject, и все доступы
заработают.

В нашей текущей настройке используется стандартный
`--authorization-mode=AlwaysAllow`, то есть всем аутентифицированным
пользователям дается полный доступ к кластеру. Для спортивности переключим этот
режим в `RBAC`.

Для админского сертификата будем использовать группу `system:masters`. Это
особая группа (захардкоженная в `kube-apiserver`), которой можно делать все.

## Генерируем сертификаты

На данном этапе нам надо создать два сертификата:

1. Сертификат для клиентского доступа, чтобы мы могли, наконец, залезть в
   кластер

2. Сертификат для kube-apiserver. Эта часть не критична, потому что
   kube-apiserver сам отлично справляется с генерацией серверного сертификата,
   но так у нас получается единый корневой CA, которому можно довериться.

```bash
#!/bin/env bash
# gen-certs.sh

set -eauxo pipefail

. config

function gen_ca() {
    local name=$1
    local subj=$2

    local key_file="$CERT_DIR/$name.key"
    local crt_file="$CERT_DIR/$name.crt"

    test -f "$key_file" || openssl genrsa -out "$key_file" 2048
    test -f "$crt_file" || openssl req -x509 -new -nodes -sha256 \
        -days 1024 \
        -subj "$subj" \
        -key "$key_file" \
        -out "$crt_file"
}

function gen_crt() {
    local name=$1
    local subj=$2
    local ca=$3

    local san=

    if [ $# -ge 4 ]; then
        san=$4
    fi

    local key_file="$CERT_DIR/$name.key"
    local crt_file="$CERT_DIR/$name.crt"
    local csr_file="$CERT_DIR/$name.csr"
    local ext_file="$CERT_DIR/$name.ext"

    local ca_key_file="$CERT_DIR/$ca.key"
    local ca_crt_file="$CERT_DIR/$ca.crt"

    local extfile=

    if [ -n "$san" ]; then
        printf "subjectAltName=DNS:$san" > "$ext_file"
        extfile="-extfile $ext_file"
    fi

    test -f "$key_file" || openssl genrsa -out "$key_file" 2048

    if ! [ -f "$crt_file" ]; then
        openssl req -new -key "$key_file" -out "$csr_file" -subj "$subj"
        openssl x509 -req -sha256 \
            $extfile \
            -days 1024 \
            -CA "$ca_crt_file" \
            -CAkey "$ca_key_file" \
            -CAcreateserial \
            -in "$csr_file" \
            -out "$crt_file"
    fi

    if [ -f "$csr_file" ]; then
        rm "$csr_file"
    fi

    if [ -f "$ext_file" ]; then
        rm "$ext_file"
    fi
}

function gen_keypair() {
    local name=$1

    local key_file="$CERT_DIR/$name.key"
    local pub_file="$CERT_DIR/$name.pub"

    test -f "$key_file" || openssl genrsa -out "$key_file" 2048
    test -f "$pub_file" || openssl rsa -in "$key_file" -pubout -out "$pub_file"
}

mkdir -p "$CERT_DIR"

gen_ca "$CA_NAME" "/CN=kubernetes"
gen_crt kube-apiserver "/O=system:masters/CN=kube-apiserver" "$CA_NAME" localhost
gen_crt admin "/O=system:masters/CN=kubernetes-admin" "$CA_NAME"
gen_crt whodis "/CN=some-user" "$CA_NAME"
gen_keypair "$SA_NAME"
```

Теперь у нас есть новая иерархия сертификатов, надо освежить команду для запуска
kube-apiserver:

```bash
#!/bin/sh
# kube-apiserver.sh

. config

CRT_FILE="$CERT_DIR/kube-apiserver.crt"
KEY_FILE="$CERT_DIR/kube-apiserver.key"

exec "$KUBE_APISERVER" \
      --api-audiences=https://127.0.0.1:6443 \
      --service-account-key-file="$SA_PUB" \
      --service-account-signing-key-file="$SA_KEY" \
      --service-account-issuer=https://kubernetes.default.svc.cluster.local \
      --etcd-servers="http://127.0.0.1:2379" \
      --client-ca-file="$CA_FILE" \
      --authorization-mode=RBAC \
      --tls-cert-file="$CRT_FILE" \
      --tls-private-key-file="$KEY_FILE"
```

Из нового здесь последние четыре аргумента - авторизовываем пользователей с
помощью корневого сертификата, используем RBAC, и теперь apiserver отвечает
клиентам не случайным самоподписным сертификатом, а уже каноничным, выписанным в
соответствии с иерархией.

После данных манипуляций можно попробовать зайти в кластер.

По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/bef4e7a03fae4930fe331ff4b5755fdaccda7d70)

## Шаг 5: Залезаем в кластер

Здесь все просто, берем старый добрый `kubectl`, и передаем ему аргументы для
того, чтобы он знал, где кластер, как в него ходить, и как ему доверять:

```bash
#!/bin/sh
# kubectl.sh

. config

CERT_NAME=admin
CRT_FILE="$CERT_DIR/$CERT_NAME.crt"
KEY_FILE="$CERT_DIR/$CERT_NAME.key"

exec kubectl \
    --client-certificate="$CRT_FILE" \
    --client-key="$KEY_FILE" \
    --server=https://localhost:6443 \
    --certificate-authority="$CA_FILE" \
        "$@"
```

```bash
kubernetes-apiserver-mac $ sh kubectl.sh get pods

No resources found in default namespace.
```

Алилуя, доступ к кластеру получен! Чтобы проверить, что RBAC работает как надо,
попробуем поменять в скрипте `CERT_NAME` на whodis - тестовый пользователь, не
состоящий ни в одной группе, а потому не имеющий доступов:

```bash
kubernetes-apiserver-mac $ sh kubectl.sh get pods

Error from server (Forbidden): pods is forbidden: User "some-user" cannot list resource "pods" in API group "" in the namespace "default"
```

Отлично, авторизация работает как надо, и у нас есть волшебный кластер, в
котором не работает ни одной ноды, и полезную нагрузку он выполнять не может.
Тяга к странному успешно достигнута.

По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/51a54ee3b05bafb17e7a02aae5f72b8e7fb5b0e6)

Воспользовавшись случаем, посмотрим, какие стандартные роли присутствуют в
кластере:

```bash
kubernetes-apiserver-mac $ sh kubectl.sh get clusterrole

NAME                                                                   CREATED AT
admin                                                                  2022-07-27T12:50:15Z
cluster-admin                                                          2022-07-27T12:50:15Z
edit                                                                   2022-07-27T12:50:15Z
system:aggregate-to-admin                                              2022-07-27T12:50:15Z
system:aggregate-to-edit                                               2022-07-27T12:50:15Z
system:aggregate-to-view                                               2022-07-27T12:50:15Z
system:auth-delegator                                                  2022-07-27T12:50:15Z
system:basic-user                                                      2022-07-27T12:50:15Z
system:certificates.k8s.io:certificatesigningrequests:nodeclient       2022-07-27T12:50:15Z
system:certificates.k8s.io:certificatesigningrequests:selfnodeclient   2022-07-27T12:50:16Z
system:certificates.k8s.io:kube-apiserver-client-approver              2022-07-27T12:50:16Z
system:certificates.k8s.io:kube-apiserver-client-kubelet-approver      2022-07-27T12:50:16Z
system:certificates.k8s.io:kubelet-serving-approver                    2022-07-27T12:50:16Z
system:certificates.k8s.io:legacy-unknown-approver                     2022-07-27T12:50:16Z
system:controller:attachdetach-controller                              2022-07-27T12:50:16Z
system:controller:certificate-controller                               2022-07-27T12:50:16Z
system:controller:clusterrole-aggregation-controller                   2022-07-27T12:50:16Z
system:controller:cronjob-controller                                   2022-07-27T12:50:16Z
system:controller:daemon-set-controller                                2022-07-27T12:50:16Z
system:controller:deployment-controller                                2022-07-27T12:50:16Z
system:controller:disruption-controller                                2022-07-27T12:50:16Z
system:controller:endpoint-controller                                  2022-07-27T12:50:16Z
system:controller:endpointslice-controller                             2022-07-27T12:50:16Z
system:controller:endpointslicemirroring-controller                    2022-07-27T12:50:16Z
system:controller:ephemeral-volume-controller                          2022-07-27T12:50:16Z
system:controller:expand-controller                                    2022-07-27T12:50:16Z
system:controller:generic-garbage-collector                            2022-07-27T12:50:16Z
system:controller:horizontal-pod-autoscaler                            2022-07-27T12:50:16Z
system:controller:job-controller                                       2022-07-27T12:50:16Z
system:controller:namespace-controller                                 2022-07-27T12:50:16Z
system:controller:node-controller                                      2022-07-27T12:50:16Z
system:controller:persistent-volume-binder                             2022-07-27T12:50:16Z
system:controller:pod-garbage-collector                                2022-07-27T12:50:16Z
system:controller:pv-protection-controller                             2022-07-27T12:50:16Z
system:controller:pvc-protection-controller                            2022-07-27T12:50:16Z
system:controller:replicaset-controller                                2022-07-27T12:50:16Z
system:controller:replication-controller                               2022-07-27T12:50:16Z
system:controller:resourcequota-controller                             2022-07-27T12:50:16Z
system:controller:root-ca-cert-publisher                               2022-07-27T12:50:16Z
system:controller:route-controller                                     2022-07-27T12:50:16Z
system:controller:service-account-controller                           2022-07-27T12:50:16Z
system:controller:service-controller                                   2022-07-27T12:50:16Z
system:controller:statefulset-controller                               2022-07-27T12:50:16Z
system:controller:ttl-after-finished-controller                        2022-07-27T12:50:16Z
system:controller:ttl-controller                                       2022-07-27T12:50:16Z
system:discovery                                                       2022-07-27T12:50:15Z
system:heapster                                                        2022-07-27T12:50:15Z
system:kube-aggregator                                                 2022-07-27T12:50:15Z
system:kube-controller-manager                                         2022-07-27T12:50:15Z
system:kube-dns                                                        2022-07-27T12:50:15Z
system:kube-scheduler                                                  2022-07-27T12:50:16Z
system:kubelet-api-admin                                               2022-07-27T12:50:15Z
system:monitoring                                                      2022-07-27T12:50:15Z
system:node                                                            2022-07-27T12:50:15Z
system:node-bootstrapper                                               2022-07-27T12:50:15Z
system:node-problem-detector                                           2022-07-27T12:50:15Z
system:node-proxier                                                    2022-07-27T12:50:16Z
system:persistent-volume-provisioner                                   2022-07-27T12:50:15Z
system:public-info-viewer                                              2022-07-27T12:50:15Z
system:service-account-issuer-discovery                                2022-07-27T12:50:16Z
system:volume-scheduler                                                2022-07-27T12:50:16Z
view                                                                   2022-07-27T12:50:15Z
```

Ох, как их много. Отметим, что в этом списке отсутствуют `system:masters` и
`system:anonimous`, так как они захардкожены прямо в `kube-apiserver`.

Но если мы хотим делать свои контроллеры, работающие с этим сервером, выписывать
сертификат каждому приложению радикально неинтересно. Куда интереснее
пользоваться механизмом `ServiceAccount`, и ходить через токены.

Попробуем завести себе `sa` и украсть его токен:

```bash
kubernetes-apiserver-mac $ sh kubectl.sh create sa test

serviceaccount/test created

kubernetes-apiserver-mac $ sh kubectl.sh get secret

No resources found in default namespace.
```

Пришла беда, откуда не ждали. А где же токен?

## Контроллеры - не часть kube-apiserver

Кубернеты внутри состоят из вагона и маленькой тележки независимых друг от друга
маленьких контроллеров, каждый из которых представляет свой reconcilliation
loop, следит только за своим объектом или даже отдельным полем объекта.
Например, за `Deployment` отвечает свой контроллер, за `ReplicaSet` отвечает
свой, за `Service` отвечает третий, и так далее. Эти контроллеры не знают ничего
друг про друга, и коммуницируют строго через API server. Но эти контроллеры *не
являются частью kube-apiserver*, они живут отдельно. Во избежание целого
зоопарка отдельных исполняемых файлов они все помещены в
`kube-controller-manager`, еще одну часть здорового Kubernetes кластера.
В данном случае нам из этих контроллеров интересны `serviceaccount` и
`serviceaccounttoken`. Закатываем рукава обратно и готовимся поднимать еще один
компонент.

## Шаг 6: Запускаем kube-controller-manager

Бинарь собирается по аналогии с `kube-apiserver` простой командой `make
kube-controller-manager`.

В отличие от `kubelet`, которому можно передать адрес `kube-apiserver` и все
сертификаты в аргументах командной строки, `kube-controller-manager` настаивает
на `kubeconfig` файле, поэтому дополним наш `gen-certs.sh` генерацией
оного. Благо формат файла позволяет ссылаться на файлы с сертификатами, поэтому
генерация достаточно простая:

```bash
function gen_kubeconfig() {
    local name=$1

    cat << EOF > "$name.kubeconfig"
apiVersion: v1
kind: Config

clusters:
  - cluster:
      certificate-authority: $CA_FILE
      server: https://localhost:6443
    name: default

users:
  - name: admin
    user:
      client-certificate: $CERT_DIR/$name.crt
      client-key: $CERT_DIR/$name.key

contexts:
  - context:
      cluster: default
      namespace: default
      user: admin
    name: default

current-context: default
EOF
}

gen_crt kube-controller-manager "/O=system:masters/CN=kube-controller-manager" "$CA_NAME" localhost
gen_kubeconfig kube-controller-manager
```

В этот раз опустим итеративный процесс, вот список параметров, которые нужны для
успешного запуска:

```bash
#!/bin/sh
# kube-controller-manager.sh

. config

exec "$KUBE_CONTROLLER_MANAGER" \
    --controllers=serviceaccount,serviceaccount-token \
    --kubeconfig kube-controller-manager.kubeconfig \
    --authentication-kubeconfig kube-controller-manager.kubeconfig \
    --authorization-kubeconfig kube-controller-manager.kubeconfig \
    --requestheader-client-ca-file="$CA_FILE" \
    --use-service-account-credentials \
    --service-account-private-key-file="$SA_KEY"
```

Все достаточно просто - указываем, какие контроллеры нам нужны, указываем наш
`kubeconfig` три раза[^4], указываем, каким сертификатом авторизовать клиентские
сертификаты[^5], просим использовать `ServiceAccount` для контроллеров и
говорим, каким ключом подписываются токены `ServiceAccount`[^6].

Запускаем, и ждем минуту, чтобы нужные нам контроллеры успели запуститься и
отработать, после можно проверять наличие секрета:

```bash
kubernetes-apiserver-mac $ kubectl.sh get secret

NAME                  TYPE                                  DATA   AGE
default-token-cp22w   kubernetes.io/service-account-token   2      15m
test-token-62jxf      kubernetes.io/service-account-token   2      4m51s
```

Отлично, токены появились, можно их воровать и пробовать использовать для
авторизации:

```bash
#!/bin/sh
# kubectl-bearer.sh

. config

SECRET=$1

shift

TOKEN=`sh kubectl.sh get secret "$SECRET" -o jsonpath='{.data.token}' | base64 -d`

exec kubectl \
    --server=https://localhost:6443 \
    --certificate-authority="$CA_FILE" \
    --token="$TOKEN" \
        "$@"
```

```
kubernetes-apiserver-mac $ sh kubectl-bearer.sh test-token-62jxf get pods

Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:default:test" cannot list resource "pods" in API group "" in the namespace "default"
```

Пользователя успешно пустило, но у него не хватило прав получить список
ресурсов. Схема работает. Можно смело создавать `ServiceAccount`, настраивать
RBAC, и использовать это хтоническое нечто в своих грязных целях.

По результатам данного шага наш код должен выглядеть примерно
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/1570ee6cce19cf18c162af205bbda7a4ebca5a66)

## На сладкое: защищаем etcd

Чтобы наш кластер был действительно production-grade, надо перевести наш etcd с
http на https.

Здесь все достаточно просто, добавляем новый сертификат в наш список для
генерации, добавляем этот сертификат в аргументы `etcd`, предоставляем CA для
аутентификации клиентов, и просим слушать на https. На стороне
`kube-apiserver`[^7] говорим, что надо стучаться не по `http://127.0.0.1:2379`,
а по `https://localhost:2379`, и предъявляем тот же сертификат, который у нас
уже есть для `kube-apiserver`. `localhost` по той причине, что в `SAN`
сертификата для `etcd` прописан именно он, а не `IP:127.0.0.1`:

```bash
#!/bin/sh
# etcd.sh

. config

CRT_FILE="$CERT_DIR/etcd.crt"
KEY_FILE="$CERT_DIR/etcd.key"

# exec allows to avoid extra shell process existing for no reason.
exec "$ETCD" \
  --name s1 \
  --data-dir=etcd-data \
  --listen-client-urls=https://127.0.0.1:2379 \
  --advertise-client-urls=https://127.0.0.1:2379 \
  --cert-file="$CRT_FILE" \
  --key-file="$KEY_FILE" \
  --client-cert-auth \
  --trusted-ca-file="$CA_FILE"
```

```bash
#!/bin/sh
# kube-apiserver.sh

. config

CRT_FILE="$CERT_DIR/kube-apiserver.crt"
KEY_FILE="$CERT_DIR/kube-apiserver.key"

exec "$KUBE_APISERVER" \
      --api-audiences=https://127.0.0.1:6443 \
      --service-account-key-file="$SA_PUB" \
      --service-account-signing-key-file="$SA_KEY" \
      --service-account-issuer=https://kubernetes.default.svc.cluster.local \
      --etcd-servers="https://localhost:2379" \
      --etcd-cafile="$CA_FILE" \
      --etcd-certfile="$CRT_FILE" \
      --etcd-keyfile="$KEY_FILE" \
      --client-ca-file="$CA_FILE" \
      --authorization-mode=RBAC \
      --tls-cert-file="$CRT_FILE" \
      --tls-private-key-file="$KEY_FILE"
```

Пересоздаем сертификаты, перезапускаем компоненты, и все заверте...

Итоговое состояние нашего кода:
[так](https://github.com/AFakeman/kubernetes-apiserver-mac/tree/99aecf64aaab1bd4b9e9f18ecf0dd84a7eafb168)

[^1]: Тут и далее я буду хардкодить версии на те, с которыми экспериментировал,
    из соображений воспроизводимости^tm.

[^2]: Я не проверял, какие зависимости надо установить, чтобы сборка прошла
  успешна, но подозреваю, что надо установить компилятор `go` какой-нибудь не
  слишком древней версии (в моем случае 1.17.6).

[^3]: К сожалению, не смог раскопать информацию, всегда ли группа пользователя
  это именно ClusterRole, или можно как-то привязать группу к обычной Role.

[^4]: Почему-то в целях аутентикации и авторизации можно предоставлять отдельный
  `kubeconfig`, не такой же, какой используется остальным контроллером, но в
  наших целях это не очень полезно. Я даже не знаю, в каких полезно.

[^5]: Не уверен, кто ходит с авторизацией к `kube-controller-manager`, хорошая
  тема для дальнейшего исследования

[^6]: Этот ключ передается и в `kube-apiserver`, и в `kube-controller-manager`.
  Не уверен, могут ли они быть различными, возможно, `kube-apiserver` использует
  их для OIDC токенов, а `kube-controller-manager` для `ServiceAccount` токенов.

[^7]: То, что из всех компонентов Kubernetes кластера доступ к `etcd` имеет
  только `kube-apiserver`, а все остальные взаимодействуют друг с другом только
  через него - это гениальный инжиниринг, позволивший альтернативные
  дистрибутивы вроде `k3s`, которые могут использовать под капотом другие базы
  навроде `sqlite`. К сожалению, в официальном дистрибутиве поддержки других баз
  так и не появилось.
