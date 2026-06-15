Feature: Navigate to Accessories from Owner menu

  Scenario: Open Hyundai Australia website and access Accessories page
    Given the user opens the Hyundai Australia website
    When the user navigates to the "Buying" menu
    And the user clicks the "Latest Offers" submenu
    Then the Offers page should be displayed
    And verify "offers" is in the url
    And verify "Latest Offers" is in the page