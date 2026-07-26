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
import "../components" as MoneroComponents
import "../components/effects" as MoneroEffects

MoneroEffects.ImageMask {
    id: button
    z: 666
    color: MoneroComponents.Style.defaultFontColor
    image: ""
    // Stable size: resizing on hover caused enter/exit loops (flashing) and lost clicks
    // on Receive copy / AddressBook action icons.
    property real baseOpacity: 1

    property alias tooltip: tooltip.text
    signal clicked(var mouse)

    MoneroComponents.Tooltip {
        id: tooltip
        // Do not fill the button with a hit-test layer; only used as a popup host.
        width: 0
        height: 0
        anchors.centerIn: parent
        tooltipLeft: true
        // Ignore mouse so parent MouseArea always receives clicks.
        enabled: false
    }

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        preventStealing: true
        acceptedButtons: Qt.LeftButton

        onEntered: {
            if (tooltip.text)
                tooltip.tooltipPopup.open();
            button.opacity = Math.min(1, (button.baseOpacity || 1) * 1.0);
            // Slight highlight without changing layout geometry
            button.scale = 1.08;
        }

        onExited: {
            if (tooltip.text)
                tooltip.tooltipPopup.close();
            button.opacity = button.baseOpacity || 1;
            button.scale = 1.0;
        }

        onClicked: {
            mouse.accepted = true;
            button.clicked(mouse);
        }
    }
}
