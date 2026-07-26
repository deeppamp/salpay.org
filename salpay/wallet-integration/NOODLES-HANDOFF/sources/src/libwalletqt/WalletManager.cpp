// Copyright (c) 2014-2024, The Monero Project
//
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of
//    conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list
//    of conditions and the following disclaimer in the documentation and/or other
//    materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be
//    used to endorse or promote products derived from this software without specific
//    prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
// STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
// THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#include "WalletManager.h"
#include "Wallet.h"
#include "wallet/api/wallet2_api.h"
#include "zxcvbn-c/zxcvbn.h"
#include "QRCodeImageProvider.h"
#include <QClipboard>
#include <QGuiApplication>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QDebug>
#include <QUrl>
#include <QtConcurrent/QtConcurrent>
#include <QMutex>
#include <QMutexLocker>
#include <QString>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QEventLoop>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QTimer>

#include "qt/updater.h"
#include "qt/ScopeGuard.h"

class WalletPassphraseListenerImpl : public  Monero::WalletListener, public PassphraseReceiver
{
public:
  WalletPassphraseListenerImpl(WalletManager * mgr): m_mgr(mgr), m_phelper(mgr) {}

  virtual void moneySpent(const std::string &txId, uint64_t amount) override { (void)txId; (void)amount; };
  virtual void moneyReceived(const std::string &txId, uint64_t amount) override { (void)txId; (void)amount; };
  virtual void unconfirmedMoneyReceived(const std::string &txId, uint64_t amount) override { (void)txId; (void)amount; };
  virtual void newBlock(uint64_t height) override { (void) height; };
  virtual void updated() override {};
  virtual void refreshed() override {};

  virtual void onPassphraseEntered(const QString &passphrase, bool enter_on_device, bool entry_abort) override
  {
      qDebug() << __FUNCTION__;
      m_phelper.onPassphraseEntered(passphrase, enter_on_device, entry_abort);
  }

  virtual Monero::optional<std::string> onDevicePassphraseRequest(bool & on_device) override
  {
      qDebug() << __FUNCTION__;
      return m_phelper.onDevicePassphraseRequest(on_device);
  }

  virtual void onDeviceButtonRequest(uint64_t code) override
  {
      qDebug() << __FUNCTION__;
      emit m_mgr->deviceButtonRequest(code);
  }

  virtual void onDeviceButtonPressed() override
  {
      qDebug() << __FUNCTION__;
      emit m_mgr->deviceButtonPressed();
  }

private:
  WalletManager * m_mgr;
  PassphraseHelper m_phelper;
};

Wallet *WalletManager::createWallet(const QString &path, const QString &password,
                                    const QString &language, NetworkType::Type nettype, quint64 kdfRounds)
{
    QMutexLocker locker(&m_mutex);
    if (m_currentWallet) {
        qDebug() << "Closing open m_currentWallet" << m_currentWallet;
        delete m_currentWallet;
    }
    Monero::Wallet * w = m_pimpl->createWallet(path.toStdString(), password.toStdString(),
                                                  language.toStdString(), static_cast<Monero::NetworkType>(nettype), kdfRounds);
    m_currentWallet  = new Wallet(w);
    return m_currentWallet;
}

Wallet *WalletManager::openWallet(const QString &path, const QString &password, NetworkType::Type nettype, quint64 kdfRounds)
{
    QMutexLocker locker(&m_mutex);
    WalletPassphraseListenerImpl tmpListener(this);
    m_mutex_passphraseReceiver.lock();
    m_passphraseReceiver = &tmpListener;
    m_mutex_passphraseReceiver.unlock();
    const auto cleanup = sg::make_scope_guard([this]() noexcept {
        QMutexLocker passphrase_locker(&m_mutex_passphraseReceiver);
        this->m_passphraseReceiver = nullptr;
    });

    if (m_currentWallet) {
        qDebug() << "Closing open m_currentWallet" << m_currentWallet;
        delete m_currentWallet;
    }
    qDebug("%s: opening wallet at %s, nettype = %d ",
           __PRETTY_FUNCTION__, qPrintable(path), nettype);

    Monero::Wallet * w =  m_pimpl->openWallet(path.toStdString(), password.toStdString(), static_cast<Monero::NetworkType>(nettype), kdfRounds, &tmpListener);
    w->setListener(nullptr);

    qDebug("%s: opened wallet: %s, status: %d", __PRETTY_FUNCTION__, w->address(0, 0).c_str(), w->status());
    m_currentWallet  = new Wallet(w);

    // move wallet to the GUI thread. Otherwise it wont be emitting signals
    if (m_currentWallet->thread() != qApp->thread()) {
        m_currentWallet->moveToThread(qApp->thread());
    }

    return m_currentWallet;
}

void WalletManager::openWalletAsync(const QString &path, const QString &password, NetworkType::Type nettype, quint64 kdfRounds)
{
    m_scheduler.run([this, path, password, nettype, kdfRounds] {
        emit walletOpened(openWallet(path, password, nettype, kdfRounds));
    });
}


Wallet *WalletManager::recoveryWallet(const QString &path, const QString &seed, const QString &seed_offset, NetworkType::Type nettype, quint64 restoreHeight, quint64 kdfRounds)
{
    QMutexLocker locker(&m_mutex);
    if (m_currentWallet) {
        qDebug() << "Closing open m_currentWallet" << m_currentWallet;
        delete m_currentWallet;
    }
    Monero::Wallet * w = m_pimpl->recoveryWallet(path.toStdString(), "", seed.toStdString(), static_cast<Monero::NetworkType>(nettype), restoreHeight, kdfRounds, seed_offset.toStdString());
    m_currentWallet = new Wallet(w);
    return m_currentWallet;
}

Wallet *WalletManager::createWalletFromKeys(const QString &path, const QString &language, NetworkType::Type nettype,
                                            const QString &address, const QString &viewkey, const QString &spendkey,
                                            quint64 restoreHeight, quint64 kdfRounds)
{
    QMutexLocker locker(&m_mutex);
    if (m_currentWallet) {
        qDebug() << "Closing open m_currentWallet" << m_currentWallet;
        delete m_currentWallet;
        m_currentWallet = NULL;
    }
    Monero::Wallet * w = m_pimpl->createWalletFromKeys(path.toStdString(), "", language.toStdString(), static_cast<Monero::NetworkType>(nettype), restoreHeight,
                                                       address.toStdString(), viewkey.toStdString(), spendkey.toStdString(), kdfRounds);
    m_currentWallet = new Wallet(w);
    return m_currentWallet;
}

Wallet *WalletManager::createWalletFromDevice(const QString &path, const QString &password, NetworkType::Type nettype,
                                              const QString &deviceName, quint64 restoreHeight, const QString &subaddressLookahead, quint64 kdfRounds)
{
    QMutexLocker locker(&m_mutex);
    WalletPassphraseListenerImpl tmpListener(this);
    m_mutex_passphraseReceiver.lock();
    m_passphraseReceiver = &tmpListener;
    m_mutex_passphraseReceiver.unlock();
    const auto cleanup = sg::make_scope_guard([this]() noexcept {
        QMutexLocker passphrase_locker(&m_mutex_passphraseReceiver);
        this->m_passphraseReceiver = nullptr;
    });

    if (m_currentWallet) {
        qDebug() << "Closing open m_currentWallet" << m_currentWallet;
        delete m_currentWallet;
        m_currentWallet = NULL;
    }
    Monero::Wallet * w = m_pimpl->createWalletFromDevice(path.toStdString(), password.toStdString(), static_cast<Monero::NetworkType>(nettype),
                                                         deviceName.toStdString(), restoreHeight, subaddressLookahead.toStdString(), kdfRounds, &tmpListener);
    w->setListener(nullptr);

    m_currentWallet = new Wallet(w);

    // move wallet to the GUI thread. Otherwise it wont be emitting signals
    if (m_currentWallet->thread() != qApp->thread()) {
        m_currentWallet->moveToThread(qApp->thread());
    }

    return m_currentWallet;
}


void WalletManager::createWalletFromDeviceAsync(const QString &path, const QString &password, NetworkType::Type nettype,
                                                const QString &deviceName, quint64 restoreHeight, const QString &subaddressLookahead, quint64 kdfRounds)
{
    m_scheduler.run([this, path, password, nettype, deviceName, restoreHeight, subaddressLookahead, kdfRounds] {
        Wallet *wallet = createWalletFromDevice(path, password, nettype, deviceName, restoreHeight, subaddressLookahead, kdfRounds);
        emit walletCreated(wallet);
    });
}

QString WalletManager::closeWallet()
{
    QMutexLocker locker(&m_mutex);
    QString result;
    if (m_currentWallet) {
        result = m_currentWallet->address(0, 0);
        delete m_currentWallet;
    } else {
        qCritical() << "Trying to close non existing wallet " << m_currentWallet;
        result = "0";
    }
    return result;
}

void WalletManager::closeWalletAsync(const QJSValue& callback)
{
    m_scheduler.run([this] {
        return QJSValueList({closeWallet()});
    }, callback);
}

bool WalletManager::walletExists(const QString &path) const
{
    return m_pimpl->walletExists(path.toStdString());
}

QStringList WalletManager::findWallets(const QString &path)
{
    std::vector<std::string> found_wallets = m_pimpl->findWallets(path.toStdString());
    QStringList result;
    for (const auto &w : found_wallets) {
        result.append(QString::fromStdString(w));
    }
    return result;
}

QString WalletManager::errorString() const
{
    return tr("Unknown error");
}

quint64 WalletManager::maximumAllowedAmount()
{
    return Monero::Wallet::maximumAllowedAmount();
}

QString WalletManager::maximumAllowedAmountAsString() const
{
    return WalletManager::displayAmount(WalletManager::maximumAllowedAmount());
}

QString WalletManager::displayAmount(quint64 amount)
{
    return QString::fromStdString(Monero::Wallet::displayAmount(amount));
}

quint64 WalletManager::amountFromString(const QString &amount)
{
    return Monero::Wallet::amountFromString(amount.toStdString());
}

quint64 WalletManager::amountFromDouble(double amount) const
{
    return Monero::Wallet::amountFromDouble(amount);
}

QString WalletManager::amountsSumFromStrings(const QVector<QString> &amounts)
{
    quint64 sum = 0;
    for (const auto &amountString : amounts)
    {
        const quint64 amount = amountFromString(amountString);
        sum = sum + std::min(maximumAllowedAmount() - sum, amount);
    }
    return QString::number(sum);
}

bool WalletManager::paymentIdValid(const QString &payment_id) const
{
    return Monero::Wallet::paymentIdValid(payment_id.toStdString());
}

bool WalletManager::addressValid(const QString &address, NetworkType::Type nettype) const
{
    return Monero::Wallet::addressValid(address.toStdString(), static_cast<Monero::NetworkType>(nettype));
}

bool WalletManager::keyValid(const QString &key, const QString &address, bool isViewKey,  NetworkType::Type nettype) const
{
    std::string error;
    if(!Monero::Wallet::keyValid(key.toStdString(), address.toStdString(), isViewKey, static_cast<Monero::NetworkType>(nettype), error)){
        qDebug() << QString::fromStdString(error);
        return false;
    }
    return true;
}

QString WalletManager::paymentIdFromAddress(const QString &address, NetworkType::Type nettype) const
{
    return QString::fromStdString(Monero::Wallet::paymentIdFromAddress(address.toStdString(), static_cast<Monero::NetworkType>(nettype)));
}

void WalletManager::setDaemonAddressAsync(const QString &address)
{
    m_scheduler.run([this, address] {
        m_pimpl->setDaemonAddress(address.toStdString());
    });
}

bool WalletManager::connected() const
{
    return m_pimpl->connected();
}

quint64 WalletManager::networkDifficulty() const
{
    return m_pimpl->networkDifficulty();
}

quint64 WalletManager::blockchainHeight() const
{
    return m_pimpl->blockchainHeight();
}

quint64 WalletManager::blockchainTargetHeight() const
{
    return m_pimpl->blockchainTargetHeight();
}

double WalletManager::miningHashRate() const
{
    return m_pimpl->miningHashRate();
}

bool WalletManager::isMining() const
{
    {
        QMutexLocker locker(&m_mutex);
        if (m_currentWallet == nullptr || !m_currentWallet->connected())
        {
            return false;
        }
    }

    return m_pimpl->isMining();
}

void WalletManager::miningStatusAsync()
{
    m_scheduler.run([this] {
        emit miningStatus(isMining());
    });
}

bool WalletManager::startMining(const QString &address, quint32 threads, bool backgroundMining, bool ignoreBattery)
{
    if(threads == 0)
        threads = 1;
    return m_pimpl->startMining(address.toStdString(), threads, backgroundMining, ignoreBattery);
}

bool WalletManager::stopMining()
{
    return m_pimpl->stopMining();
}

bool WalletManager::localDaemonSynced() const
{
    return blockchainHeight() > 1 && blockchainHeight() >= blockchainTargetHeight();
}

bool WalletManager::isDaemonLocal(const QString &daemon_address) const
{
    return daemon_address.isEmpty() ? false : Monero::Utils::isAddressLocal(daemon_address.toStdString());
}

QString WalletManager::resolveOpenAlias(const QString &address) const
{
    bool dnssec_valid = false;
    std::string res = m_pimpl->resolveOpenAlias(address.toStdString(), dnssec_valid);
    res = std::string(dnssec_valid ? "true" : "false") + "|" + res;
    return QString::fromStdString(res);
}
bool WalletManager::parse_uri(const QString &uri, QString &address, QString &payment_id, uint64_t &amount, QString &tx_description, QString &recipient_name, QVector<QString> &unknown_parameters, QString &error) const
{
    QMutexLocker locker(&m_mutex);
    if (m_currentWallet)
        return m_currentWallet->parse_uri(uri, address, payment_id, amount, tx_description, recipient_name, unknown_parameters, error);
    return false;
}

QVariantMap WalletManager::parse_uri_to_object(const QString &uri) const
{
    QString address;
    QString payment_id;
    uint64_t amount = 0;
    QString tx_description;
    QString recipient_name;
    QVector<QString> unknown_parameters;
    QString error;

    QVariantMap result;
    if (this->parse_uri(uri, address, payment_id, amount, tx_description, recipient_name, unknown_parameters, error)) {
        result.insert("address", address);
        result.insert("payment_id", payment_id);
        result.insert("amount", amount > 0 ? displayAmount(amount) : "");
        result.insert("tx_description", tx_description);
        result.insert("recipient_name", recipient_name);

        QVariantMap extra_parameters;
        if (unknown_parameters.size() > 0)
        {
            for (const QString &item : unknown_parameters)
            {
                const auto parsed_item = item.splitRef("=");
                if (parsed_item.size() == 2)
                {
                    extra_parameters.insert(parsed_item[0].toString(), parsed_item[1].toString());
                }
            }
        }
        result.insert("extra_parameters", extra_parameters);
    } else {
        result.insert("error", !error.isEmpty() ? error : tr("Unknown error"));
    }

    return result;
}

QString WalletManager::make_uri(const QString &address, const quint64 &amount, const QString &tx_description, const QString &recipient_name) const
{
    QMutexLocker locker(&m_mutex);
    if (m_currentWallet)
        return m_currentWallet->make_uri(address, amount, tx_description, recipient_name);
    return "";
}

void WalletManager::setLogLevel(int logLevel)
{
    Monero::WalletManagerFactory::setLogLevel(logLevel);
}

void WalletManager::setLogCategories(const QString &categories)
{
    Monero::WalletManagerFactory::setLogCategories(categories.toStdString());
}

QString WalletManager::urlToLocalPath(const QUrl &url) const
{
    return QDir::toNativeSeparators(url.toLocalFile());
}

QUrl WalletManager::localPathToUrl(const QString &path) const
{
    return QUrl::fromLocalFile(path);
}

double WalletManager::getPasswordStrength(const QString &password) const
{
    static const char *local_dict[] = {
        "monero", "fluffypony", NULL
    };

    if (!ZxcvbnInit("zxcvbn.dict")) {
        fprintf(stderr, "Failed to open zxcvbn.dict\n");
        return 0.0;
    }
    double e = ZxcvbnMatch(password.toStdString().c_str(), local_dict, NULL);
    ZxcvbnUnInit();
    return e;
}

bool WalletManager::saveQrCode(const QString &code, const QString &path) const
{
    QSize size;
    return QRCodeImageProvider::genQrImage(code, &size).scaled(size.expandedTo(QSize(240, 240)), Qt::KeepAspectRatio).save(path, "PNG", 100);
}

void WalletManager::saveQrCodeToClipboard(const QString &code) const
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    QSize size;
    clipboard->setImage(QRCodeImageProvider::genQrImage(code, &size).scaled(size.expandedTo(QSize(240, 240)), Qt::KeepAspectRatio), QClipboard::Clipboard);
    clipboard->setImage(QRCodeImageProvider::genQrImage(code, &size).scaled(size.expandedTo(QSize(240, 240)), Qt::KeepAspectRatio), QClipboard::Selection);
}

void WalletManager::checkUpdatesAsync(
    const QString &software,
    const QString &subdir,
    const QString &buildTag,
    const QString &version)
{
    m_scheduler.run([this, software, subdir, buildTag, version] {
        const auto updateInfo = Monero::WalletManager::checkUpdates(
            software.toStdString(),
            subdir.toStdString(),
            buildTag.toStdString().c_str(),
            version.toStdString().c_str());
        if (!std::get<0>(updateInfo))
        {
            return;
        }

        const QString version = QString::fromStdString(std::get<1>(updateInfo));
        const QByteArray hashFromDns = QByteArray::fromHex(QString::fromStdString(std::get<2>(updateInfo)).toUtf8());
        const QString downloadUrl = QString::fromStdString(std::get<4>(updateInfo));

        try
        {
            const QString binaryFilename = QUrl(downloadUrl).fileName();
            QPair<QString, QString> signers;
            const QString signedHash = Updater().fetchSignedHash(binaryFilename, hashFromDns, signers).toHex();

            qInfo() << "Update found" << version << downloadUrl << "hash" << signedHash << "signed by" << signers;
            emit checkUpdatesComplete(version, downloadUrl, signedHash, signers.first, signers.second);
        }
        catch (const std::exception &e)
        {
            qCritical() << "Failed to fetch and verify signed hash:" << e.what();
        }
    });
}

QString WalletManager::checkUpdates(const QString &software, const QString &subdir) const
{
  qDebug() << "Checking for updates";
  const std::tuple<bool, std::string, std::string, std::string, std::string> result = Monero::WalletManager::checkUpdates(software.toStdString(), subdir.toStdString());
  if (!std::get<0>(result))
    return QString("");
  return QString::fromStdString(std::get<1>(result) + "|" + std::get<2>(result) + "|" + std::get<3>(result) + "|" + std::get<4>(result));
}

bool WalletManager::clearWalletCache(const QString &wallet_path) const
{

    QString fileName = wallet_path;
    // Make sure wallet file is not .keys
    fileName.replace(".keys","");
    QFile walletCache(fileName);
    QString suffix = ".old_cache";
    QString newFileName = fileName + suffix;

    // create unique file name
    for (int i = 1; QFile::exists(newFileName); i++) {
       newFileName = QString("%1%2.%3").arg(fileName).arg(suffix).arg(i);
    }

    return walletCache.rename(newFileName);
}

WalletManager::WalletManager(QObject *parent)
    : QObject(parent)
    , m_passphraseReceiver(nullptr)
    , m_scheduler(this)
    , m_salpayApiBase("")
    , m_salpayEnabled(false)
{
    m_pimpl =  Monero::WalletManagerFactory::getWalletManager();
}

WalletManager::~WalletManager()
{
    m_scheduler.shutdownWaitForFinished();
}

void WalletManager::onWalletPassphraseNeeded(bool on_device)
{
    emit this->walletPassphraseNeeded(on_device);
}

void WalletManager::onPassphraseEntered(const QString &passphrase, bool enter_on_device, bool entry_abort)
{
    QMutexLocker locker(&m_mutex_passphraseReceiver);
    if (m_passphraseReceiver != nullptr)
    {
        m_passphraseReceiver->onPassphraseEntered(passphrase, enter_on_device, entry_abort);
    }
}

QString WalletManager::proxyAddress() const
{
    QMutexLocker locker(&m_proxyMutex);
    return m_proxyAddress;
}

void WalletManager::setProxyAddress(QString address)
{
    m_scheduler.run([this, address] {
        {
            QMutexLocker locker(&m_proxyMutex);

            if (!m_pimpl->setProxy(address.toStdString()))
            {
                qCritical() << "Failed to set proxy address" << address;
            }

            m_proxyAddress = std::move(address);
        }
        emit proxyAddressChanged();
    });
}

// Salpay resolver integration
QString WalletManager::salpayApiBase() const
{
    QMutexLocker locker(&m_salpayMutex);
    return m_salpayApiBase;
}

void WalletManager::setSalpayApiBase(const QString &base)
{
    QMutexLocker locker(&m_salpayMutex);
    m_salpayApiBase = base;
    qDebug() << "Salpay API base set to:" << base;
}

bool WalletManager::salpayEnabled() const
{
    QMutexLocker locker(&m_salpayMutex);
    return m_salpayEnabled;
}

void WalletManager::setSalpayEnabled(bool enabled)
{
    QMutexLocker locker(&m_salpayMutex);
    m_salpayEnabled = enabled;
    qDebug() << "Salpay integration" << (enabled ? "enabled" : "disabled");
}

QVariantMap WalletManager::resolveSalpayName(const QString &name) const
{
    QVariantMap result;
    
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    // Build the resolve endpoint URL
    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/resolve/" + QUrl::toPercentEncoding(name);

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");
    
    // Set a timeout using an event loop
    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    
    QNetworkReply *reply = nam.get(request);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    
    timeout.start(5000); // 5 second timeout
    eventLoop.exec();
    
    if (!timeout.isActive()) {
        // Timeout occurred
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();
    
    QByteArray responseData = reply->readAll();
    const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QString networkError = reply->errorString();
    const bool hadNetworkError = reply->error() != QNetworkReply::NoError;
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (jsonDoc.isObject()) {
        QJsonObject jsonObj = jsonDoc.object();
        if (jsonObj.value("success").toBool()) {
            result.insert("success", true);
            result.insert("name", jsonObj.value("name").toString());
            result.insert("source", jsonObj.value("source").toString());
            result.insert("ticker", jsonObj.value("ticker").toString());
            result.insert("resolved_address", jsonObj.value("resolved_address").toString());
            result.insert("image_url", jsonObj.value("image_url").toString());
            result.insert("image_url_absolute", jsonObj.value("image_url_absolute").toString());
            result.insert("image_hash", jsonObj.value("image_hash").toString());
            result.insert("records", jsonObj.value("records").toObject().toVariantMap());
            return result;
        }

        // Prefer API error text (e.g. 404 name not found) over raw Qt network wording.
        result.insert("success", false);
        result.insert("status_code", statusCode);
        result.insert("error", jsonObj.value("error").toString(
            statusCode == 404 ? QStringLiteral("Name not found") : networkError));
        return result;
    }

    if (hadNetworkError) {
        qWarning() << "Salpay resolve request failed:" << networkError << "status=" << statusCode;
        result.insert("success", false);
        result.insert("status_code", statusCode);
        // Common when API base points at wrong host (e.g. production while testing offline).
        if (networkError.contains(QStringLiteral("Host not found"), Qt::CaseInsensitive)
                || networkError.contains(QStringLiteral("Connection refused"), Qt::CaseInsensitive)
                || networkError.contains(QStringLiteral("Server Not Found"), Qt::CaseInsensitive)) {
            result.insert("error",
                QStringLiteral("Cannot reach Salpay API at %1 (%2). On testnet use http://127.0.0.1:3001")
                    .arg(m_salpayApiBase, networkError));
        } else {
            result.insert("error", QStringLiteral("Network error: %1").arg(networkError));
        }
        return result;
    }

    result.insert("success", false);
    result.insert("error", "Invalid JSON response");
    return result;
}

QVariantMap WalletManager::checkSalpayName(const QString &name) const
{
    QVariantMap result;
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString normalized = name.trimmed().toLower();
    if (!normalized.endsWith(QStringLiteral(".sal")))
        normalized += QStringLiteral(".sal");

    QString url = m_salpayApiBase;
    if (!url.endsWith(QLatin1Char('/')))
        url += QLatin1Char('/');
    url += QStringLiteral("api/registry/check?name=")
        + QString::fromUtf8(QUrl::toPercentEncoding(normalized));

    QNetworkAccessManager nam;
    QNetworkRequest request;
    request.setUrl(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("User-Agent", "SalPay-GUI/1.0");

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QNetworkReply *reply = nam.get(request);
    QObject::connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    QObject::connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    timeout.start(8000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->abort();
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    const QByteArray responseData = reply->readAll();
    const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const bool hadNetworkError = reply->error() != QNetworkReply::NoError;
    const QString networkError = reply->errorString();
    reply->deleteLater();

    const QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("status_code", statusCode);
        result.insert("error", hadNetworkError ? networkError : QStringLiteral("Invalid JSON"));
        return result;
    }

    const QJsonObject o = jsonDoc.object();
    result.insert("success", o.value(QStringLiteral("success")).toBool(true));
    result.insert("name", o.value(QStringLiteral("name")).toString(normalized));
    result.insert("available", o.value(QStringLiteral("available")).toBool());
    result.insert("exists", o.value(QStringLiteral("exists")).toBool());
    result.insert("minted", o.value(QStringLiteral("minted")).toBool());
    result.insert("reserved", o.value(QStringLiteral("reserved")).toBool());
    result.insert("taken", o.value(QStringLiteral("taken")).toBool());
    result.insert("found", o.value(QStringLiteral("found")).toBool());
    result.insert("ticker", o.value(QStringLiteral("ticker")).toString());
    result.insert("source", o.value(QStringLiteral("source")).toString());
    result.insert("reservation_id", o.value(QStringLiteral("reservation_id")).toString());
    if (o.contains(QStringLiteral("error")))
        result.insert("error", o.value(QStringLiteral("error")).toString());
    return result;
}

// Salpay mint flow integration
QVariantMap WalletManager::listSalpayNamesByAddress(const QString &address) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    const QString trimmed = address.trimmed();
    if (trimmed.isEmpty()) {
        result.insert("success", false);
        result.insert("error", "address is required");
        return result;
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/"))
        url += "/";
    url += "api/names/by-address?address=" + QString::fromUtf8(QUrl::toPercentEncoding(trimmed));

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QNetworkReply *reply = nam.get(request);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    timeout.start(5000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    QByteArray responseData = reply->readAll();
    const bool hadNetworkError = reply->error() != QNetworkReply::NoError;
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", hadNetworkError ? QStringLiteral("Network error listing SalPay names") : QStringLiteral("Invalid JSON response"));
        return result;
    }

    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString("Failed to list names"));
        return result;
    }

    result.insert("success", true);
    result.insert("address", jsonObj.value("address").toString());
    result.insert("count", jsonObj.value("count").toInt());
    result.insert("names", jsonObj.value("names").toArray().toVariantList());
    return result;
}

QVariantMap WalletManager::getMintQuote(const QString &name, const QString &paymentAddress, const QString &ticker) const
{
    QVariantMap result;
    
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    Q_UNUSED(paymentAddress);
    url += "api/mint/quote";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QJsonObject payload;
    payload.insert("name", name);
    if (!ticker.trimmed().isEmpty()) {
        payload.insert("ticker", ticker.trimmed().toUpper());
    }
    QJsonDocument requestDoc(payload);
    QByteArray requestData = requestDoc.toJson(QJsonDocument::Compact);
    
    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    
    QNetworkReply *reply = nam.post(request, requestData);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    
    timeout.start(5000);
    eventLoop.exec();
    
    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();
    
    if (reply->error() != QNetworkReply::NoError) {
        const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        QByteArray responseData = reply->readAll();
        QJsonDocument errDoc = QJsonDocument::fromJson(responseData);

        result.insert("success", false);
        result.insert("status_code", statusCode);
        if (errDoc.isObject()) {
            QJsonObject errObj = errDoc.object();
            result.insert("error", errObj.value("error").toString(reply->errorString()));
            result.insert("status", errObj.value("status").toString());
            result.insert("verification_mode", errObj.value("verification_mode").toString());
            result.insert("proof_reason", errObj.value("proof_reason").toString());
            result.insert("ticker", errObj.value("ticker").toString());
            // Resumable reserved-name quote/reserve payloads.
            if (errObj.contains("resumable"))
                result.insert("resumable", errObj.value("resumable").toBool());
            if (errObj.contains("reservation_id"))
                result.insert("reservation_id", errObj.value("reservation_id").toString());
            if (errObj.contains("name"))
                result.insert("name", errObj.value("name").toString());
            if (errObj.contains("fee"))
                result.insert("fee", errObj.value("fee").toVariant());
            if (errObj.contains("treasury_address"))
                result.insert("treasury_address", errObj.value("treasury_address").toString());
            if (errObj.contains("payment_outputs"))
                result.insert("payment_outputs", errObj.value("payment_outputs").toArray().toVariantList());
            if (errObj.contains("expires_at"))
                result.insert("expires_at", errObj.value("expires_at").toString());
            if (errObj.contains("available_ticker_suggestions")) {
                result.insert("available_ticker_suggestions",
                              errObj.value("available_ticker_suggestions").toArray().toVariantList());
            }
            if (errObj.contains("details")) {
                const QJsonValue detailsValue = errObj.value("details");
                if (detailsValue.isObject()) {
                    result.insert("details", detailsValue.toObject().toVariantMap());
                }
            }
        } else {
            result.insert("error", reply->errorString());
        }
        reply->deleteLater();
        return result;
    }
    
    QByteArray responseData = reply->readAll();
    reply->deleteLater();
    
    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }
    
    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString());
        result.insert("ticker", jsonObj.value("ticker").toString());
        if (jsonObj.contains("resumable"))
            result.insert("resumable", jsonObj.value("resumable").toBool());
        if (jsonObj.contains("reservation_id"))
            result.insert("reservation_id", jsonObj.value("reservation_id").toString());
        if (jsonObj.contains("fee"))
            result.insert("fee", jsonObj.value("fee").toVariant());
        if (jsonObj.contains("treasury_address"))
            result.insert("treasury_address", jsonObj.value("treasury_address").toString());
        if (jsonObj.contains("payment_outputs"))
            result.insert("payment_outputs", jsonObj.value("payment_outputs").toArray().toVariantList());
        if (jsonObj.contains("available_ticker_suggestions")) {
            result.insert("available_ticker_suggestions",
                          jsonObj.value("available_ticker_suggestions").toArray().toVariantList());
        }
        return result;
    }
    
    result.insert("success", true);
    result.insert("name", jsonObj.value("name").toString());
    result.insert("ticker", jsonObj.value("ticker").toString());
    result.insert("fee", jsonObj.value("fee").toVariant());
    result.insert("treasury_address", jsonObj.value("treasury_address").toString());
    result.insert("payment_outputs", jsonObj.value("payment_outputs").toArray().toVariantList());
    result.insert("note", jsonObj.value("note").toString());
    result.insert("reservation_id", jsonObj.value("reservation_id").toString());
    result.insert("expires_at", jsonObj.value("expires_at").toString());
    if (jsonObj.contains("available_ticker_suggestions")) {
        result.insert("available_ticker_suggestions",
                      jsonObj.value("available_ticker_suggestions").toArray().toVariantList());
    }
    if (jsonObj.contains("preferred_ticker"))
        result.insert("preferred_ticker", jsonObj.value("preferred_ticker").toString());
    if (jsonObj.contains("resumable"))
        result.insert("resumable", jsonObj.value("resumable").toBool());
    
    return result;
}

QVariantMap WalletManager::getMintTickerSuggestions(const QString &name, int limit) const
{
    QVariantMap result;
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    const int lim = qBound(1, limit > 0 ? limit : 5, 20);
    QString url = m_salpayApiBase;
    if (!url.endsWith(QLatin1Char('/')))
        url += QLatin1Char('/');
    url += QStringLiteral("api/mint/ticker-suggestions?name=")
        + QString::fromUtf8(QUrl::toPercentEncoding(name.trimmed().toLower()))
        + QStringLiteral("&limit=") + QString::number(lim);

    QNetworkAccessManager nam;
    QNetworkRequest request;
    request.setUrl(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("User-Agent", "SalPay-GUI/1.0");

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QNetworkReply *reply = nam.get(request);
    QObject::connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    QObject::connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    timeout.start(8000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->abort();
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    const QByteArray responseData = reply->readAll();
    const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const bool hadNetworkError = reply->error() != QNetworkReply::NoError;
    const QString networkError = reply->errorString();
    reply->deleteLater();

    const QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("status_code", statusCode);
        result.insert("error", hadNetworkError ? networkError : QStringLiteral("Invalid JSON response"));
        return result;
    }

    const QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value(QStringLiteral("success")).toBool()) {
        result.insert("success", false);
        result.insert("status_code", statusCode);
        result.insert("error", jsonObj.value(QStringLiteral("error")).toString(networkError));
        return result;
    }

    result.insert("success", true);
    result.insert("name", jsonObj.value(QStringLiteral("name")).toString());
    result.insert("desired_ticker", jsonObj.value(QStringLiteral("desired_ticker")).toString());
    result.insert("desired_available", jsonObj.value(QStringLiteral("desired_available")).toBool());
    result.insert("desired_owner", jsonObj.value(QStringLiteral("desired_owner")).toString());
    result.insert("suggested_ticker", jsonObj.value(QStringLiteral("suggested_ticker")).toString());
    result.insert("preferred_ticker", jsonObj.value(QStringLiteral("preferred_ticker")).toString());
    result.insert("available_ticker_suggestions",
                  jsonObj.value(QStringLiteral("available_ticker_suggestions")).toArray().toVariantList());
    result.insert("count", jsonObj.value(QStringLiteral("count")).toInt());
    result.insert("note", jsonObj.value(QStringLiteral("note")).toString());
    result.insert("name_already_minted", jsonObj.value(QStringLiteral("name_already_minted")).toBool());
    result.insert("source", jsonObj.value(QStringLiteral("source")).toString());
    return result;
}

QVariantMap WalletManager::getMintQuoteByReservation(const QString &reservationId) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/quote";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QJsonObject payload;
    payload.insert("reservation_id", reservationId);
    QJsonDocument requestDoc(payload);
    QByteArray requestData = requestDoc.toJson(QJsonDocument::Compact);

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);

    QNetworkReply *reply = nam.post(request, requestData);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));

    timeout.start(5000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    QByteArray responseData = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        reply->deleteLater();

        QJsonDocument errDoc = QJsonDocument::fromJson(responseData);
        if (errDoc.isObject()) {
            QJsonObject errObj = errDoc.object();
            result.insert("success", false);
            result.insert("error", errObj.value("error").toString(reply->errorString()));
            result.insert("status_code", statusCode);
            if (errObj.contains("reservation_id"))
                result.insert("reservation_id", errObj.value("reservation_id").toString());
            if (errObj.contains("expires_at"))
                result.insert("expires_at", errObj.value("expires_at").toString());
            return result;
        }

        result.insert("success", false);
        result.insert("error", reply->errorString());
        result.insert("status_code", statusCode);
        return result;
    }
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }

    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString());
        return result;
    }

    result.insert("success", true);
    result.insert("reservation_id", jsonObj.value("reservation_id").toString());
    result.insert("name", jsonObj.value("name").toString());
    result.insert("ticker", jsonObj.value("ticker").toString());
    result.insert("fee", jsonObj.value("fee").toVariant());
    result.insert("treasury_address", jsonObj.value("treasury_address").toString());
    result.insert("payment_outputs", jsonObj.value("payment_outputs").toArray().toVariantList());
    result.insert("expires_at", jsonObj.value("expires_at").toString());

    return result;
}

QVariantMap WalletManager::releaseMintReservation(const QString &reservationId) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/release";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QJsonObject payload;
    payload.insert("reservation_id", reservationId);
    QJsonDocument doc(payload);
    QByteArray data = doc.toJson(QJsonDocument::Compact);

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);

    QNetworkReply *reply = nam.post(request, data);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));

    timeout.start(5000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    QByteArray responseData = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        reply->deleteLater();

        QJsonDocument errDoc = QJsonDocument::fromJson(responseData);
        if (errDoc.isObject()) {
            QJsonObject errObj = errDoc.object();
            result.insert("success", false);
            result.insert("error", errObj.value("error").toString(reply->errorString()));
            result.insert("status_code", statusCode);
            return result;
        }

        result.insert("success", false);
        result.insert("error", reply->errorString());
        result.insert("status_code", statusCode);
        return result;
    }
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }

    QJsonObject jsonObj = jsonDoc.object();
    result.insert("success", jsonObj.value("success").toBool());
    result.insert("released", jsonObj.value("released").toBool());
    result.insert("reservation_id", jsonObj.value("reservation_id").toString());
    result.insert("name", jsonObj.value("name").toString());
    if (!jsonObj.value("success").toBool()) {
        result.insert("error", jsonObj.value("error").toString("Release failed"));
    }

    return result;
}

QVariantMap WalletManager::createMintReservation(const QString &name, const QString &paymentAddress, const QString &ticker, const QString &imageUrl, const QString &imageHash) const
{
    QVariantMap result;
    
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/reserve";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");
    
    QJsonObject payload;
    payload.insert("name", name);
    payload.insert("primary_address", paymentAddress);
    if (!ticker.trimmed().isEmpty()) {
        payload.insert("ticker", ticker.trimmed().toUpper());
    }
    if (!imageUrl.trimmed().isEmpty()) {
        payload.insert("image_url", imageUrl.trimmed());
    }
    if (!imageHash.trimmed().isEmpty()) {
        payload.insert("image_hash", imageHash.trimmed().toLower());
    }
    QJsonDocument doc(payload);
    QByteArray data = doc.toJson(QJsonDocument::Compact);
    
    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    
    QNetworkReply *reply = nam.post(request, data);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    
    timeout.start(5000);
    eventLoop.exec();
    
    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();
    
    QByteArray responseData = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        const int statusCode = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        reply->deleteLater();

        QJsonDocument errDoc = QJsonDocument::fromJson(responseData);
        if (errDoc.isObject()) {
            QJsonObject errObj = errDoc.object();
            result.insert("success", false);
            result.insert("error", errObj.value("error").toString(reply->errorString()));
            result.insert("status_code", statusCode);
            result.insert("ticker", errObj.value("ticker").toString());
            if (errObj.contains("reservation_id"))
                result.insert("reservation_id", errObj.value("reservation_id").toString());
            if (errObj.contains("expires_at"))
                result.insert("expires_at", errObj.value("expires_at").toString());
            // Resumable "already reserved" payload (fee/treasury locked on server).
            if (errObj.contains("resumable"))
                result.insert("resumable", errObj.value("resumable").toBool());
            if (errObj.contains("name"))
                result.insert("name", errObj.value("name").toString());
            if (errObj.contains("fee"))
                result.insert("fee", errObj.value("fee").toVariant());
            if (errObj.contains("treasury_address"))
                result.insert("treasury_address", errObj.value("treasury_address").toString());
            if (errObj.contains("payment_outputs"))
                result.insert("payment_outputs", errObj.value("payment_outputs").toArray().toVariantList());
            if (errObj.contains("payment_mode"))
                result.insert("payment_mode", errObj.value("payment_mode").toString());
            if (errObj.contains("note"))
                result.insert("note", errObj.value("note").toString());
            if (errObj.contains("available_ticker_suggestions")) {
                result.insert("available_ticker_suggestions",
                              errObj.value("available_ticker_suggestions").toArray().toVariantList());
            }
            return result;
        }

        result.insert("success", false);
        result.insert("error", reply->errorString());
        result.insert("status_code", statusCode);
        return result;
    }

    reply->deleteLater();
    
    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }
    
    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString());
        return result;
    }
    
    result.insert("success", true);
    result.insert("reservation_id", jsonObj.value("reservation_id").toString());
    result.insert("name", jsonObj.value("name").toString());
    result.insert("ticker", jsonObj.value("ticker").toString());
    result.insert("fee", jsonObj.value("fee").toVariant());
    result.insert("treasury_address", jsonObj.value("treasury_address").toString());
    result.insert("payment_outputs", jsonObj.value("payment_outputs").toArray().toVariantList());
    result.insert("expires_at", jsonObj.value("expires_at").toString());
    result.insert("ttl_seconds", jsonObj.value("ttl_seconds").toInt());
    result.insert("image_url", jsonObj.value("image_url").toString());
    result.insert("image_url_absolute", jsonObj.value("image_url_absolute").toString());
    result.insert("image_hash", jsonObj.value("image_hash").toString());
    
    return result;
}

QVariantMap WalletManager::uploadNameImage(const QString &filePath) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString localPath = filePath.trimmed();
    if (localPath.startsWith(QStringLiteral("file:"), Qt::CaseInsensitive)) {
        localPath = QUrl(localPath).toLocalFile();
    }
    QFileInfo info(localPath);
    if (!info.exists() || !info.isFile()) {
        result.insert("success", false);
        result.insert("error", "Image file not found");
        return result;
    }
    // ~512KB default server limit; reject early at 600KB raw.
    if (info.size() <= 0 || info.size() > 600 * 1024) {
        result.insert("success", false);
        result.insert("error", "Image must be under 512 KB");
        return result;
    }

    QFile file(info.absoluteFilePath());
    if (!file.open(QIODevice::ReadOnly)) {
        result.insert("success", false);
        result.insert("error", "Could not read image file");
        return result;
    }
    const QByteArray bytes = file.readAll();
    file.close();
    if (bytes.isEmpty()) {
        result.insert("success", false);
        result.insert("error", "Empty image file");
        return result;
    }

    // Magic-byte sniff first (extension is often wrong for offline sample downloads).
    QString contentType;
    const bool isPng = bytes.size() >= 4
        && static_cast<unsigned char>(bytes.at(0)) == 0x89
        && bytes.at(1) == 'P' && bytes.at(2) == 'N' && bytes.at(3) == 'G';
    const bool isJpeg = bytes.size() >= 2
        && static_cast<unsigned char>(bytes.at(0)) == 0xFF
        && static_cast<unsigned char>(bytes.at(1)) == 0xD8;
    const bool isWebp = bytes.size() >= 12
        && bytes.startsWith("RIFF")
        && bytes.mid(8, 4) == "WEBP";
    if (isPng) contentType = QStringLiteral("image/png");
    else if (isJpeg) contentType = QStringLiteral("image/jpeg");
    else if (isWebp) contentType = QStringLiteral("image/webp");
    else {
        const QString suffix = info.suffix().toLower();
        if (suffix == QStringLiteral("png")) contentType = QStringLiteral("image/png");
        else if (suffix == QStringLiteral("jpg") || suffix == QStringLiteral("jpeg") || suffix == QStringLiteral("jfif"))
            contentType = QStringLiteral("image/jpeg");
        else if (suffix == QStringLiteral("webp")) contentType = QStringLiteral("image/webp");
        else {
            result.insert("success", false);
            result.insert("error", "Use a real PNG, JPEG, or WebP image file");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/"))
        url += "/";
    url += "api/mint/upload-image";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QJsonObject payload;
    payload.insert("content_type", contentType);
    payload.insert("image_base64", QString::fromLatin1(bytes.toBase64()));
    QJsonDocument doc(payload);
    QByteArray data = doc.toJson(QJsonDocument::Compact);

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QNetworkReply *reply = nam.post(request, data);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    timeout.start(15000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Image upload timeout");
        return result;
    }
    timeout.stop();

    QByteArray responseData = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        reply->deleteLater();
        QJsonDocument errDoc = QJsonDocument::fromJson(responseData);
        if (errDoc.isObject()) {
            result.insert("success", false);
            result.insert("error", errDoc.object().value("error").toString(reply->errorString()));
            return result;
        }
        result.insert("success", false);
        result.insert("error", reply->errorString());
        return result;
    }
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }
    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString("Upload failed"));
        return result;
    }

    result.insert("success", true);
    result.insert("image_url", jsonObj.value("image_url").toString());
    result.insert("image_url_absolute", jsonObj.value("image_url_absolute").toString());
    result.insert("image_hash", jsonObj.value("image_hash").toString());
    result.insert("content_type", jsonObj.value("content_type").toString(contentType));
    result.insert("size_bytes", jsonObj.value("size_bytes").toVariant());
    // Local file path so QML can preview immediately even if remote image fetch fails.
    result.insert("local_path", info.absoluteFilePath());
    result.insert("local_file_url", QUrl::fromLocalFile(info.absoluteFilePath()).toString());
    return result;
}
QVariantMap WalletManager::checkMintVerification(const QString &reservationId) const
{
    QVariantMap result;
    
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/status/" + QUrl::toPercentEncoding(reservationId);

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");
    
    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    
    QNetworkReply *reply = nam.get(request);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    
    timeout.start(5000);
    eventLoop.exec();
    
    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();
    
    if (reply->error() != QNetworkReply::NoError) {
        result.insert("success", false);
        result.insert("error", reply->errorString());
        reply->deleteLater();
        return result;
    }
    
    QByteArray responseData = reply->readAll();
    reply->deleteLater();
    
    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }
    
    QJsonObject jsonObj = jsonDoc.object();
    result.insert("success", jsonObj.value("success").toBool());
    result.insert("status", jsonObj.value("status").toString());
    result.insert("job_id", jsonObj.value("job_id").toString());
    result.insert("tx_hash", jsonObj.value("tx_hash").toString());
    
    return result;
}

QVariantMap WalletManager::verifyMintPayment(const QString &reservationId, double amount, const QString &txHash, const QString &toAddress, const QVariantList &outputs, const QString &burnTxHash) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/verify-payment";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QJsonObject payload;
    payload.insert("reservation_id", reservationId);
    payload.insert("amount", amount);
    payload.insert("tx_hash", txHash);
    payload.insert("treasury_tx_hash", txHash);
    payload.insert("to_address", toAddress);
    if (!burnTxHash.trimmed().isEmpty()) {
        payload.insert("burn_tx_hash", burnTxHash.trimmed());
    }
    if (!outputs.isEmpty()) {
        QJsonArray jsonOutputs;
        for (const QVariant &item : outputs) {
            const QVariantMap out = item.toMap();
            const QString address = out.value("address").toString();
            const QVariant amountVar = out.value("amount");
            if (!amountVar.isValid()) {
                continue;
            }
            // Protocol burn legs have no SC address — still send role/kind/amount for policy audit.
            QJsonObject outObj;
            if (!address.isEmpty())
                outObj.insert("address", address);
            outObj.insert("amount", amountVar.toDouble());
            if (out.contains("role"))
                outObj.insert("role", out.value("role").toString());
            if (out.contains("kind"))
                outObj.insert("kind", out.value("kind").toString());
            jsonOutputs.append(outObj);
        }
        payload.insert("outputs", jsonOutputs);
    }
    QJsonDocument doc(payload);
    QByteArray data = doc.toJson(QJsonDocument::Compact);

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);

    QNetworkReply *reply = nam.post(request, data);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));

    timeout.start(7000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    if (reply->error() != QNetworkReply::NoError) {
        result.insert("success", false);
        result.insert("error", reply->errorString());
        reply->deleteLater();
        return result;
    }

    QByteArray responseData = reply->readAll();
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }

    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString("Verify failed"));
        result.insert("status", jsonObj.value("status").toString());
        result.insert("verification_mode", jsonObj.value("verification_mode").toString());
        result.insert("proof_reason", jsonObj.value("proof_reason").toString());
        if (jsonObj.contains("details")) {
            const QJsonValue detailsValue = jsonObj.value("details");
            if (detailsValue.isObject()) {
                result.insert("details", detailsValue.toObject().toVariantMap());
            }
        }
        return result;
    }

    result.insert("success", true);
    result.insert("status", jsonObj.value("status").toString());
    result.insert("verification_mode", jsonObj.value("verification_mode").toString());
    result.insert("paid_amount", jsonObj.value("paid_amount").toVariant());
    result.insert("required_amount", jsonObj.value("required_amount").toVariant());
    result.insert("tx_hash", jsonObj.value("tx_hash").toString());
    result.insert("verified_at", jsonObj.value("verified_at").toString());

    return result;
}

QVariantMap WalletManager::executeMint(const QString &reservationId, const QString &idempotencyKey) const
{
    QVariantMap result;
    
    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/execute";

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");
    
    QJsonObject payload;
    payload.insert("reservation_id", reservationId);
    payload.insert("idempotency_key", idempotencyKey);
    QJsonDocument doc(payload);
    QByteArray data = doc.toJson(QJsonDocument::Compact);
    
    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);
    
    QNetworkReply *reply = nam.post(request, data);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));
    
    timeout.start(5000);
    eventLoop.exec();
    
    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();
    
    if (reply->error() != QNetworkReply::NoError) {
        result.insert("success", false);
        result.insert("error", reply->errorString());
        reply->deleteLater();
        return result;
    }
    
    QByteArray responseData = reply->readAll();
    reply->deleteLater();
    
    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }
    
    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString());
        return result;
    }
    
    result.insert("success", true);
    result.insert("job_id", jsonObj.value("job_id").toString());
    result.insert("status", jsonObj.value("status").toString());
    result.insert("tx_hash", jsonObj.value("tx_hash").toString());

    return result;
}

QVariantMap WalletManager::getMintStatus(const QString &jobId) const
{
    QVariantMap result;

    {
        QMutexLocker locker(&m_salpayMutex);
        if (!m_salpayEnabled || m_salpayApiBase.isEmpty()) {
            result.insert("success", false);
            result.insert("error", "Salpay integration not configured");
            return result;
        }
    }

    QString url = m_salpayApiBase;
    if (!url.endsWith("/")) {
        url += "/";
    }
    url += "api/mint/status/" + QUrl::toPercentEncoding(jobId);

    QNetworkAccessManager nam;
    QNetworkRequest request = QNetworkRequest(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("User-Agent", "Salvium-GUI/1.0");

    QEventLoop eventLoop;
    QTimer timeout;
    timeout.setSingleShot(true);

    QNetworkReply *reply = nam.get(request);
    connect(reply, SIGNAL(finished()), &eventLoop, SLOT(quit()));
    connect(&timeout, SIGNAL(timeout()), &eventLoop, SLOT(quit()));

    timeout.start(7000);
    eventLoop.exec();

    if (!timeout.isActive()) {
        reply->deleteLater();
        result.insert("success", false);
        result.insert("error", "Request timeout");
        return result;
    }
    timeout.stop();

    if (reply->error() != QNetworkReply::NoError) {
        result.insert("success", false);
        result.insert("error", reply->errorString());
        reply->deleteLater();
        return result;
    }

    QByteArray responseData = reply->readAll();
    reply->deleteLater();

    QJsonDocument jsonDoc = QJsonDocument::fromJson(responseData);
    if (!jsonDoc.isObject()) {
        result.insert("success", false);
        result.insert("error", "Invalid JSON response");
        return result;
    }

    QJsonObject jsonObj = jsonDoc.object();
    if (!jsonObj.value("success").toBool()) {
        result.insert("success", false);
        result.insert("error", jsonObj.value("error").toString("Mint status unavailable"));
        return result;
    }

    result.insert("success", true);
    result.insert("job_id", jsonObj.value("id").toString());
    result.insert("status", jsonObj.value("status").toString());
    result.insert("tx_hash", jsonObj.value("tx_hash").toString());
    result.insert("name", jsonObj.value("name").toString());
    
    return result;
}

QVariantMap WalletManager::probeDaemonInfo(const QString &hostPort) const
{
    QVariantMap result;
    result.insert("success", false);

    QString hp = hostPort.trimmed();
    if (hp.isEmpty()) {
        result.insert("error", "empty host");
        return result;
    }

    QString url = hp;
    if (!url.startsWith(QStringLiteral("http://"), Qt::CaseInsensitive)
            && !url.startsWith(QStringLiteral("https://"), Qt::CaseInsensitive)) {
        url = QStringLiteral("http://") + url;
    }
    if (!url.contains(QStringLiteral("/json_rpc"))) {
        if (url.endsWith(QLatin1Char('/')))
            url += QStringLiteral("json_rpc");
        else
            url += QStringLiteral("/json_rpc");
    }

    QNetworkAccessManager nam;
    QNetworkRequest request;
    request.setUrl(QUrl(url));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("User-Agent", "SalPay-GUI/1.0");

    const QByteArray body = QByteArrayLiteral(
        "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_info\",\"params\":{}}");

    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QNetworkReply *reply = nam.post(request, body);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timeout, &QTimer::timeout, &loop, &QEventLoop::quit);
    timeout.start(6000);
    loop.exec();

    if (!timeout.isActive()) {
        reply->abort();
        reply->deleteLater();
        result.insert("error", "timeout");
        return result;
    }
    timeout.stop();

    const QByteArray responseData = reply->readAll();
    const bool netErr = reply->error() != QNetworkReply::NoError;
    const QString netErrStr = reply->errorString();
    reply->deleteLater();

    if (netErr && responseData.isEmpty()) {
        result.insert("error", netErrStr);
        return result;
    }

    const QJsonDocument doc = QJsonDocument::fromJson(responseData);
    if (!doc.isObject()) {
        result.insert("error", "invalid json");
        return result;
    }
    const QJsonObject root = doc.object();
    const QJsonObject res = root.value(QStringLiteral("result")).toObject();
    if (res.isEmpty()) {
        result.insert("error", root.value(QStringLiteral("error")).toObject().value(QStringLiteral("message")).toString("no result"));
        return result;
    }

    result.insert("success", true);
    result.insert("height", static_cast<qint64>(res.value(QStringLiteral("height")).toDouble()));
    // When bootstrap-daemon is active, height can be the remote tip while the local
    // LMDB is still catching up. Prefer height_without_bootstrap for honest local progress.
    const qint64 heightNoBootstrap = static_cast<qint64>(
        res.value(QStringLiteral("height_without_bootstrap")).toDouble());
    result.insert("height_without_bootstrap",
                  heightNoBootstrap > 0 ? heightNoBootstrap
                                        : static_cast<qint64>(res.value(QStringLiteral("height")).toDouble()));
    result.insert("target_height", static_cast<qint64>(res.value(QStringLiteral("target_height")).toDouble()));
    result.insert("synchronized", res.value(QStringLiteral("synchronized")).toBool());
    result.insert("busy_syncing", res.value(QStringLiteral("busy_syncing")).toBool());
    result.insert("outgoing_connections_count", res.value(QStringLiteral("outgoing_connections_count")).toInt());
    result.insert("incoming_connections_count", res.value(QStringLiteral("incoming_connections_count")).toInt());
    result.insert("white_peerlist_size", res.value(QStringLiteral("white_peerlist_size")).toInt());
    result.insert("grey_peerlist_size", res.value(QStringLiteral("grey_peerlist_size")).toInt());
    result.insert("untrusted", res.value(QStringLiteral("untrusted")).toBool());
    result.insert("was_bootstrap_ever_used", res.value(QStringLiteral("was_bootstrap_ever_used")).toBool());
    result.insert("bootstrap_daemon_address", res.value(QStringLiteral("bootstrap_daemon_address")).toString());
    result.insert("mainnet", res.value(QStringLiteral("mainnet")).toBool());
    result.insert("offline", res.value(QStringLiteral("offline")).toBool());
    return result;
}
