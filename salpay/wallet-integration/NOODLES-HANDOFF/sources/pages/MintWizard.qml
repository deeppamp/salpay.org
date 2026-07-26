import QtQuick 2.9
import QtQuick.Layouts 1.1
import QtQuick.Controls 1.1

import "../components" as MoneroComponents
import moneroComponents.WalletManager 1.0

ColumnLayout {
    id: mintWizard
    spacing: 20
    readonly property color salBrandGreen: "#00c853"
    readonly property string salNameRuleMessage: "Name must use 1-63 lowercase letters, numbers, or hyphens before .sal, and start/end with a letter or number."
    
    // State tracking
    property string currentStep: "nameEntry"  // nameEntry, quote, payment, verify, complete
    property string selectedName: ""
    property var quoteData: ({})
    property var reservationData: ({})
    property bool isProcessing: false
    property string errorMessage: ""
    
    // Signals
    signal closeRequested()
    
    // Timer for verification polling
    Timer {
        id: verificationTimer
        interval: 3000  // Poll every 3 seconds
        running: currentStep === "verify"
        repeat: true
        onTriggered: checkVerification()
    }
    
    function startMintFlow() {
        currentStep = "nameEntry";
        selectedName = "";
        quoteData = {};
        reservationData = {};
        errorMessage = "";
    }

    function isValidSalName(name) {
        return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$/.test(String(name || "").trim().toLowerCase());
    }
    
    function requestQuote() {
        if (!isValidSalName(selectedName)) {
            errorMessage = salNameRuleMessage;
            return;
        }
        
        isProcessing = true;
        errorMessage = "";
        
        // Get the user's primary address from wallet
        if (!currentWallet) {
            errorMessage = "No wallet open";
            isProcessing = false;
            return;
        }
        
        const primaryAddress = currentWallet.address(0, 0);
        
        const quote = walletManager.getMintQuote(selectedName, primaryAddress);
        
        if (quote.success) {
            quoteData = quote;
            currentStep = "quote";
        } else {
            errorMessage = "Failed to get quote: " + quote.error;
        }
        
        isProcessing = false;
    }
    
    function acceptQuote() {
        isProcessing = true;
        errorMessage = "";
        
        if (!currentWallet) {
            errorMessage = "No wallet open";
            isProcessing = false;
            return;
        }
        
        const primaryAddress = currentWallet.address(0, 0);
        
        const reservation = walletManager.createMintReservation(selectedName, primaryAddress);
        
        if (reservation.success) {
            reservationData = reservation;
            currentStep = "verify";
        } else {
            errorMessage = "Failed to create reservation: " + reservation.error;
        }
        
        isProcessing = false;
    }
    
    function checkVerification() {
        if (!reservationData.reservation_id) {
            return;
        }
        
        const verifyResult = walletManager.checkMintVerification(reservationData.reservation_id);
        
        if (verifyResult.success && verifyResult.verified) {
            // Payment verified, ready to execute
            currentStep = "execute";
            verificationTimer.running = false;
            executeMint();
        } else if (!verifyResult.success) {
            errorMessage = "Verification check failed: " + verifyResult.error;
            verificationTimer.running = false;
        }
    }
    
    function executeMint() {
        isProcessing = true;
        errorMessage = "";
        
        // Generate a unique idempotency key
        const idempotencyKey = walletManager.make_uri(selectedName + "-" + new Date().getTime());
        
        const executeResult = walletManager.executeMint(reservationData.reservation_id, idempotencyKey);
        
        if (executeResult.success) {
            reservationData.transaction_hash = executeResult.transaction_hash;
            currentStep = "complete";
        } else {
            errorMessage = "Mint execution failed: " + executeResult.error;
            currentStep = "verify";  // Go back to verify step
        }
        
        isProcessing = false;
    }
    
    // Step 1: Name Entry
    ColumnLayout {
        visible: currentStep === "nameEntry"
        Layout.fillWidth: true
        spacing: 15
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Mint a .SAL Name"
            font.pixelSize: 20
            font.bold: true
            color: salBrandGreen
            themeTransition: false
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Enter the name you want to mint (without .sal extension for now)"
            color: salBrandGreen
            themeTransition: false
            wrapMode: Text.WordWrap
        }
        
        Rectangle {
            Layout.fillWidth: true
            height: 50
            color: MoneroComponents.Style.inputBackgroundColor
            border.color: MoneroComponents.Style.inputBorderColorInActive
            border.width: 1
            radius: 4
            
            TextInput {
                id: nameInput
                anchors.fill: parent
                anchors.margins: 10
                verticalAlignment: Text.AlignVCenter
                font.pixelSize: 14
                text: selectedName.replace(".sal", "")
                onTextChanged: selectedName = text.toLowerCase() + ".sal"
                placeholderText: "alice"
            }
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Will register as: " + selectedName
            color: MoneroComponents.Style.successColor
            font.pixelSize: 12
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: errorMessage
            color: MoneroComponents.Style.errorColor
            wrapMode: Text.WordWrap
            visible: errorMessage !== ""
        }
        
        MoneroComponents.StandardButton {
            Layout.fillWidth: true
            text: isProcessing ? "Loading..." : "Get Quote"
            enabled: !isProcessing && isValidSalName(selectedName)
            onClicked: requestQuote()
        }
    }
    
    // Step 2: Show Quote
    ColumnLayout {
        visible: currentStep === "quote"
        Layout.fillWidth: true
        spacing: 15
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Mint Quote"
            font.pixelSize: 18
            font.bold: true
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Name: " + selectedName
            font.pixelSize: 14
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Amount: " + quoteData.amount + " " + quoteData.currency
            font.pixelSize: 14
            font.bold: true
            color: MoneroComponents.Style.positiveColor
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Valid for: " + quoteData.ttl + " seconds"
            font.pixelSize: 12
            color: MoneroComponents.Style.defaultFontColor
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Payment address: " + reservationData.payment_address
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            color: MoneroComponents.Style.defaultFontColor
        }
        
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: MoneroComponents.Style.inputBorderColorInActive
        }
        
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            
            MoneroComponents.StandardButton {
                Layout.fillWidth: true
                text: "Back"
                onClicked: currentStep = "nameEntry"
            }
            
            MoneroComponents.StandardButton {
                Layout.fillWidth: true
                text: isProcessing ? "Processing..." : "Continue"
                enabled: !isProcessing
                onClicked: acceptQuote()
            }
        }
    }
    
    // Step 3: Verification Polling
    ColumnLayout {
        visible: currentStep === "verify"
        Layout.fillWidth: true
        spacing: 15
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Waiting for Payment"
            font.pixelSize: 18
            font.bold: true
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Reservation ID: " + reservationData.reservation_id
            font.pixelSize: 12
            wrapMode: Text.WordWrap
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Please send " + quoteData.amount + " " + quoteData.currency + " to the payment address shown during checkout."
            wrapMode: Text.WordWrap
            color: MoneroComponents.Style.defaultFontColor
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Payment verification in progress..."
            color: MoneroComponents.Style.processIndicationColor
            font.bold: true
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: errorMessage
            color: MoneroComponents.Style.errorColor
            wrapMode: Text.WordWrap
            visible: errorMessage !== ""
        }
        
        MoneroComponents.StandardButton {
            Layout.fillWidth: true
            text: "Cancel"
            onClicked: {
                verificationTimer.running = false
                currentStep = "nameEntry"
            }
        }
    }
    
    // Step 4: Mint Complete
    ColumnLayout {
        visible: currentStep === "complete"
        Layout.fillWidth: true
        spacing: 15
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Mint Complete!"
            font.pixelSize: 20
            font.bold: true
            color: MoneroComponents.Style.positiveColor
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: selectedName + " is now minted"
            font.pixelSize: 16
        }
        
        MoneroComponents.Label {
            Layout.fillWidth: true
            text: "Transaction: " + (reservationData.transaction_hash || "pending")
            font.pixelSize: 12
            wrapMode: Text.WordWrap
            color: MoneroComponents.Style.defaultFontColor
        }
        
        MoneroComponents.StandardButton {
            Layout.fillWidth: true
            text: "Mint Another Name"
            onClicked: startMintFlow()
        }
        
        MoneroComponents.StandardButton {
            Layout.fillWidth: true
            text: "Close"
            onClicked: {
                console.log("Mint wizard closed")
                mintWizard.closeRequested()
            }
        }
    }
}
