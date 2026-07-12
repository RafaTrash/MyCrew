# Guia Passo a Passo — Raspberry Pi 3 para Estufa Indoor

**Como usar este guia:** siga na ordem. Você vai ligar **um sensor por vez** e testar antes de ir pro próximo. Assim, se algo não funcionar, você sabe exatamente qual ligação checar — em vez de montar tudo e não saber qual dos 6 sensores está com problema.

Tempo estimado total: 1h30 a 2h30, com calma.

---

## Etapa 0 — Antes de começar

### O que você precisa ter em mãos
- Raspberry Pi 3 (desligado da tomada por enquanto)
- Todos os 8 itens da sua lista
- Um resistor de 4.7kΩ (geralmente vem no kit do DS18B20 — confira o saquinho)
- Cabo micro-USB de alimentação do Pi
- Um computador para acessar o Pi (via SSH ou monitor/teclado conectado direto)

### Regra de ouro
👉 **Sempre desligue o Pi da energia antes de mexer em qualquer fio.** Ligar/desligar jumpers com o Pi energizado pode danificar a placa ou os sensores.

### Preparando a protoboard (trilhas de alimentação)

Antes de ligar qualquer sensor, prepare a protoboard como uma "central de distribuição":

1. Identifique as duas trilhas vermelhas (+) e duas azuis/pretas (−) nas bordas da protoboard.
2. Com o Pi **desligado**, ligue um jumper do **pino 1 (3.3V)** do Pi até uma trilha vermelha.
3. Ligue um jumper do **pino 6 (GND)** do Pi até uma trilha azul/preta.
4. Ligue um jumper do **pino 2 ou 4 (5V)** do Pi até a **outra** trilha vermelha (a que sobrou) — você vai ter uma trilha de 3.3V e outra de 5V separadas.
5. Ligue as duas trilhas de GND entre si (uma ponta a outra) para que qualquer ponto da protoboard tenha GND disponível.

Resultado: você terá na protoboard uma trilha de **3.3V**, uma de **5V** e GND comum, prontas para alimentar todos os módulos sem sobrecarregar os pinos do Pi.

```
Pino físico do Pi     →  Trilha da protoboard
1  (3.3V)              →  Trilha vermelha A
2 ou 4 (5V)             →  Trilha vermelha B
6  (GND)                →  Trilha azul/preta (ligada à outra trilha GND)
```

---

## Etapa 1 — Ligar e testar o Display OLED (o mais fácil, começa por ele)

### Ligação
| OLED | Onde ligar |
|---|---|
| VCC | Trilha 3.3V da protoboard |
| GND | Trilha GND da protoboard |
| SDA | Pino 3 do Pi (GPIO2) |
| SCL | Pino 5 do Pi (GPIO3) |

### Ativar o I2C no sistema
Ligue o Pi, acesse via SSH (ou terminal direto) e rode:

```bash
sudo raspi-config
```
→ `Interface Options` → `I2C` → `Enable` → `Finish` → aceite reiniciar.

Depois que reiniciar, instale a ferramenta de diagnóstico:

```bash
sudo apt update
sudo apt install -y i2c-tools python3-pip python3-venv
```

### Testar
```bash
i2cdetect -y 1
```

Você deve ver o número `3c` aparecer na tabela. Se aparecer, o OLED está sendo reconhecido — parabéns, a base do barramento I2C está funcionando. Se **não** aparecer, confira os 4 fios antes de continuar (é sempre fio invertido ou mal encaixado).

---

## Etapa 2 — Adicionar o BME280

### Ligação (adicione estes fios, sem tirar os do OLED)
| BME280 | Onde ligar |
|---|---|
| VCC | Trilha **5V** da protoboard (esse módulo é a versão 5V) |
| GND | Trilha GND da protoboard |
| SDA | Mesma trilha SDA do OLED (pino 3 do Pi) |
| SCL | Mesma trilha SCL do OLED (pino 5 do Pi) |

### Testar
```bash
i2cdetect -y 1
```
Agora deve aparecer **`3c`** (OLED) **e `76`** (BME280) na mesma tabela. Se `76` não aparecer, teste alimentar em 3.3V em vez de 5V, e/ou verifique se o endereço não é `77` em vez de `76` (varia por lote).

---

## Etapa 3 — Adicionar o BH1750

### Ligação
| BH1750 | Onde ligar |
|---|---|
| VCC | Trilha 3.3V da protoboard |
| GND | Trilha GND da protoboard |
| SDA | Mesma trilha SDA (pino 3) |
| SCL | Mesma trilha SCL (pino 5) |
| ADDR | Deixe sem ligar (endereço fica em `0x23`) |

### Testar
```bash
i2cdetect -y 1
```
Agora deve aparecer `23`, `3c` e `76` juntos.

---

## Etapa 4 — Adicionar o ADS1115 + sensor de umidade do solo

### Ligação do ADS1115
| ADS1115 | Onde ligar |
|---|---|
| VDD | Trilha 3.3V da protoboard |
| GND | Trilha GND da protoboard |
| SDA | Mesma trilha SDA (pino 3) |
| SCL | Mesma trilha SCL (pino 5) |
| ADDR | Ligue ao GND (endereço fica em `0x48`) |

### Ligação do sensor de solo (no ADS1115, não direto no Pi)
| Sensor de solo | Onde ligar |
|---|---|
| VCC | Trilha 3.3V da protoboard |
| GND | Trilha GND da protoboard |
| AOUT | Entrada **A0** do ADS1115 |

### Testar
```bash
i2cdetect -y 1
```
Agora deve aparecer `23`, `3c`, `48` e `76` — os 4 endereços I2C juntos. Se todos aparecerem, o barramento I2C inteiro está pronto.

---

## Etapa 5 — Adicionar o DS18B20 (o único que não é I2C)

Este é o único sensor que **não** vai nas trilhas SDA/SCL — ele usa um protocolo diferente (1-Wire) e vai direto num GPIO separado do Pi.

### Ligação
| DS18B20 (fio) | Onde ligar |
|---|---|
| Vermelho (VDD) | Trilha 3.3V da protoboard |
| Preto (GND) | Trilha GND da protoboard |
| Amarelo (Data) | **Pino 7 do Pi (GPIO4)** |

⚠️ **Não pule este passo:** coloque o **resistor de 4.7kΩ** entre o fio amarelo (dados) e a trilha de 3.3V, na protoboard. Sem ele, o sensor não é detectado.

### Ativar o 1-Wire no sistema
```bash
sudo raspi-config
```
→ `Interface Options` → `1-Wire` → `Enable` → `Finish` → reinicie:
```bash
sudo reboot
```

### Testar
```bash
ls /sys/bus/w1/devices/
```
Deve aparecer uma pasta começando com `28-...`. Se não aparecer, confira: 1-Wire habilitado, fio no pino 7, e o resistor pull-up.

✅ **Neste ponto, todos os 6 sensores/módulos estão fisicamente ligados e reconhecidos pelo sistema.**

---

## Etapa 6 — Instalar as bibliotecas Python

```bash
python3 -m venv ~/grow-env
source ~/grow-env/bin/activate

pip install adafruit-blinka
pip install adafruit-circuitpython-bme280
pip install adafruit-circuitpython-ads1x15
pip install adafruit-circuitpython-ssd1306
pip install smbus2 pillow
```

> Toda vez que for testar ou rodar os scripts abaixo, ative o ambiente primeiro:
> ```bash
> source ~/grow-env/bin/activate
> ```

---

## Etapa 7 — Testar cada sensor com Python (um script por vez)

Crie uma pasta para organizar:
```bash
mkdir ~/estufa
cd ~/estufa
```

### 7.1 — Testar o OLED
Crie o arquivo:
```bash
nano teste_oled.py
```
Cole:
```python
import board, busio
import adafruit_ssd1306
from PIL import Image, ImageDraw

i2c = busio.I2C(board.SCL, board.SDA)
oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3C)

oled.fill(0)
oled.show()

imagem = Image.new("1", (oled.width, oled.height))
draw = ImageDraw.Draw(imagem)
draw.text((0, 0), "Estufa Indoor", fill=255)
draw.text((0, 16), "OLED OK!", fill=255)

oled.image(imagem)
oled.show()
```
Salve (`Ctrl+O`, Enter, `Ctrl+X`) e rode:
```bash
python3 teste_oled.py
```
A tela do OLED deve mostrar o texto. ✅

### 7.2 — Testar o BME280
```bash
nano teste_bme280.py
```
```python
import board, busio
import adafruit_bme280.basic as adafruit_bme280

i2c = busio.I2C(board.SCL, board.SDA)
bme = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)

print(f"Temperatura: {bme.temperature:.1f} C")
print(f"Umidade: {bme.relative_humidity:.1f} %")
print(f"Pressao: {bme.pressure:.1f} hPa")
```
```bash
python3 teste_bme280.py
```
Deve imprimir valores plausíveis (temperatura do ambiente, umidade entre 0-100%). ✅

### 7.3 — Testar o BH1750
```bash
nano teste_bh1750.py
```
```python
import smbus2

bus = smbus2.SMBus(1)
data = bus.read_i2c_block_data(0x23, 0x20, 2)
lux = (data[0] << 8 | data[1]) / 1.2
print(f"Luminosidade: {lux:.1f} lux")
```
```bash
python3 teste_bh1750.py
```
Tampe o sensor com a mão e rode de novo — o valor deve cair bastante. ✅

### 7.4 — Testar o ADS1115 + sensor de solo
```bash
nano teste_solo.py
```
```python
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

i2c = busio.I2C(board.SCL, board.SDA)
ads = ADS.ADS1115(i2c, address=0x48)
canal = AnalogIn(ads, ADS.P0)

print(f"Tensao: {canal.voltage:.3f} V")
```
```bash
python3 teste_solo.py
```
**Agora faça a calibração** (importante, guarde esses dois números):
1. Com o sensor seco, ao ar livre → rode o script → anote a tensão (ex: `2.20`).
2. Coloque só a ponta metálica do sensor num copo d'água → rode de novo → anote a tensão (ex: `1.10`).
3. Guarde os dois valores — vamos usar na Etapa 8.

### 7.5 — Testar o DS18B20
```bash
nano teste_ds18b20.py
```
```python
import glob

device_file = glob.glob('/sys/bus/w1/devices/28*')[0] + '/w1_slave'

with open(device_file, 'r') as f:
    linhas = f.readlines()
pos = linhas[1].find('t=')
temp = float(linhas[1][pos + 2:]) / 1000.0
print(f"Temperatura DS18B20: {temp:.2f} C")
```
```bash
python3 teste_ds18b20.py
```
Segure a ponta da sonda com os dedos e rode de novo — a temperatura deve subir. ✅

**Se todos os 5 testes acima funcionaram, todo o hardware está 100% ligado e funcional.**

---

## Etapa 8 — Script final (painel integrado)

Substitua `SECO` e `MOLHADO` pelos valores que você anotou na Etapa 7.4.

```bash
nano painel.py
```
```python
import time, glob
import board, busio, smbus2
import adafruit_bme280.basic as adafruit_bme280
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn
import adafruit_ssd1306
from PIL import Image, ImageDraw

# --- Setup ---
i2c = busio.I2C(board.SCL, board.SDA)
bme = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)
ads = ADS.ADS1115(i2c, address=0x48)
canal_solo = AnalogIn(ads, ADS.P0)
oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3C)
bus_bh1750 = smbus2.SMBus(1)
device_file = glob.glob('/sys/bus/w1/devices/28*')[0] + '/w1_slave'

# --- Calibração do solo (troque pelos seus valores) ---
SECO, MOLHADO = 2.20, 1.10

def ler_ds18b20():
    with open(device_file, 'r') as f:
        linhas = f.readlines()
    pos = linhas[1].find('t=')
    return float(linhas[1][pos + 2:]) / 1000.0

def ler_lux():
    dados = bus_bh1750.read_i2c_block_data(0x23, 0x20, 2)
    return (dados[0] << 8 | dados[1]) / 1.2

def umidade_solo_pct(tensao):
    pct = (SECO - tensao) / (SECO - MOLHADO) * 100
    return max(0, min(100, pct))

while True:
    temp_ar = bme.temperature
    umid_ar = bme.relative_humidity
    pressao = bme.pressure
    temp_solo = ler_ds18b20()
    lux = ler_lux()
    umid_solo = umidade_solo_pct(canal_solo.voltage)

    print(f"Ar: {temp_ar:.1f}C {umid_ar:.0f}% {pressao:.0f}hPa | "
          f"Solo: {temp_solo:.1f}C {umid_solo:.0f}% | Luz: {lux:.0f}lux")

    imagem = Image.new("1", (oled.width, oled.height))
    draw = ImageDraw.Draw(imagem)
    draw.text((0, 0), f"Ar: {temp_ar:.1f}C {umid_ar:.0f}%", fill=255)
    draw.text((0, 14), f"Solo: {temp_solo:.1f}C {umid_solo:.0f}%", fill=255)
    draw.text((0, 28), f"Luz: {lux:.0f} lux", fill=255)
    draw.text((0, 42), f"Press: {pressao:.0f} hPa", fill=255)
    oled.image(imagem)
    oled.show()

    time.sleep(5)
```
```bash
python3 painel.py
```
O OLED deve começar a mostrar os 4 valores, atualizando a cada 5 segundos. Pare com `Ctrl+C`.

---

## Solução rápida de problemas

| Sintoma | Causa provável |
|---|---|
| `i2cdetect` não mostra nada | I2C não habilitado, ou Pi não reiniciou após habilitar |
| Um endereço específico some | Fio SDA/SCL invertido ou GND não comum naquele módulo |
| DS18B20 não aparece em `/sys/bus/w1/devices/` | 1-Wire não habilitado, fio no pino errado, ou faltou o resistor 4.7kΩ |
| Sensor de solo sempre no mesmo valor | Confira alimentação (3.3V) e se AOUT está mesmo no A0 |
| `ModuleNotFoundError` ao rodar script | Esqueceu de ativar o ambiente: `source ~/grow-env/bin/activate` |

---

## Próximos passos (depois que tudo estiver estável)

- Rodar o `painel.py` automaticamente no boot (serviço `systemd`)
- Salvar o histórico de leituras em CSV ou SQLite
- Irrigação automática usando a leitura do sensor de solo (precisa de relé + bomba — posso te ajudar com isso depois)
