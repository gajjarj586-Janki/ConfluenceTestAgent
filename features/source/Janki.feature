Feature: Hyundai Australia Build & Price Navigation

  Scenario: Verify Build & Price button navigates to calculator page
    Given user navigates to Home
    When user clicks on the first "BUILD & PRICE" button
    Then user should be redirected to a URL containing "/calculator"