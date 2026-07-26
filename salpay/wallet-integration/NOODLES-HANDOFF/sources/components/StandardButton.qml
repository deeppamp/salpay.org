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

import QtQuick 2.9
import QtQuick.Layouts 1.1

import FontAwesome 1.0

import "../components" as MoneroComponents

Item {
    id: button
    property bool fontAwesomeIcon: false
    property bool primary: true
    property string rightIcon: ""
    property string rightIconInactive: ""
    property color textColor: primary ? MoneroComponents.Style.buttonTextColor : MoneroComponents.Style.buttonSecondaryTextColor;
    property bool small: false
    // Opt-in quiet mode for tight list rows (Receive). Defaults keep normal app buttons unchanged.
    property bool pointingHandCursor: true
    property bool hoverHighlight: true
    property alias text: label.text
    property alias fontBold: label.font.bold
    property int fontSize: {
        if(small) return 13.5;
        else return 16;
    }
    property alias label: label
    property alias tooltip: tooltip.text
    property alias tooltipLeft: tooltip.tooltipLeft
    property alias tooltipPopup: tooltip.tooltipPopup
    signal clicked()

    height: small ?  30 : 36
    width: buttonLayout.width + 22
    implicitHeight: height
    implicitWidth: width

    function doClick(){
        // Avoid releaseFocus() on every press — it refocuses the window tree and
        // makes Receive/list buttons flicker. Callers that need it can focus out themselves.
        clicked();
    }

    Rectangle {
        id: buttonRect
        anchors.fill: parent
        radius: 3
        border.width: parent.focus && parent.enabled ? 1 : 0
        opacity: 1

        state: button.enabled ? "active" : "disabled"
        Component.onCompleted: state = state

        states: [
            State {
                name: "hover"
                when: button.enabled && button.hoverHighlight && (buttonArea.containsMouse || button.focus)
                PropertyChanges {
                    target: buttonRect
                    color: primary
                        ? MoneroComponents.Style.buttonBackgroundColorHover
                        : MoneroComponents.Style.buttonSecondaryBackgroundColorHover
                }
            },
            State {
                name: "active"
                when: button.enabled
                PropertyChanges {
                    target: buttonRect
                    color: primary
                        ? MoneroComponents.Style.buttonBackgroundColor
                        : MoneroComponents.Style.buttonSecondaryBackgroundColor
                }
            },
            State {
                name: "disabled"
                when: !button.enabled
                PropertyChanges {
                    target: buttonRect
                    opacity: 0.5
                    color: primary
                        ? MoneroComponents.Style.buttonBackgroundColor
                        : MoneroComponents.Style.buttonSecondaryBackgroundColor
                }
                PropertyChanges {
                    target: label
                    opacity: 0.5
                }
            }
        ]

        // No ColorAnimation on hover — it caused visible flicker on small row buttons.
        transitions: Transition {
            enabled: false
            ColorAnimation { duration: 0 }
        }
    }

    RowLayout {
        id: buttonLayout
        height: button.height
        spacing: 11
        anchors.centerIn: parent

        MoneroComponents.TextPlain {
            id: label
            font.family: MoneroComponents.Style.fontBold.name
            font.bold: button.primary ? true : false
            font.pixelSize: button.fontSize
            // Keep solid text on press (old transparent/swap layer caused flicker)
            color: button.textColor
            visible: text !== ""
            themeTransition: false
        }

        Image {
            visible: !fontAwesomeIcon && button.rightIcon !== ""
            Layout.alignment: Qt.AlignVCenter | Qt.AlignRight
            width: button.small ? 16 : 20
            height: button.small ? 16 : 20
            opacity: buttonRect.opacity
            source: {
                if (fontAwesomeIcon) return "";
                if(button.rightIconInactive !== "" && !button.enabled) {
                    return button.rightIconInactive;
                }
                return button.rightIcon;
            }
        }

        Text {
            Layout.alignment: Qt.AlignVCenter | Qt.AlignRight
            color: MoneroComponents.Style.defaultFontColor
            font.family: FontAwesome.fontFamilySolid
            font.pixelSize: button.small ? 16 : 20
            font.styleName: "Solid"
            text: button.rightIcon
            visible: fontAwesomeIcon && button.rightIcon !== ""
        }
    }

    MoneroComponents.Tooltip {
        id: tooltip
        // Do not cover the button hit target (breaks clicks inside Flickable)
        width: 0
        height: 0
        anchors.centerIn: parent
        enabled: false
    }

    MouseArea {
        id: buttonArea
        anchors.fill: parent
        // Hover only when needed (highlight or tooltip) — reduces enter/exit churn on list rows
        hoverEnabled: button.hoverHighlight || (tooltip.text && tooltip.text.length > 0)
        preventStealing: true
        acceptedButtons: Qt.LeftButton
        z: 10
        cursorShape: button.pointingHandCursor ? Qt.PointingHandCursor : Qt.ArrowCursor
        // onPressed is more reliable than onClicked inside parent Flickable
        onPressed: {
            mouse.accepted = true;
            doClick();
        }
        onEntered: (button.hoverHighlight && tooltip.text) ? tooltip.tooltipPopup.open() : ""
        onExited: tooltip.text ? tooltip.tooltipPopup.close() : ""
    }

    Keys.enabled: button.visible
    Keys.onSpacePressed: doClick()
    Keys.onEnterPressed: Keys.onReturnPressed(event)
    Keys.onReturnPressed: doClick()
}
