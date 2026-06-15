@Genesis @FormValidation @AllFieldsFilled @Positive
Feature: Genesis Forms - Submit with all fields including Last Name shows Thank you

  Background:
    Given I am a user on the Genesis website

  @BATD
  Scenario: BATD - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/support/contact-us.html#bookatestdrive"
    When I fill in all required fields
      | Field                    | Value                    |
      | Vehicle Selection        | GV60                     |
      | First Name               | Janki                    |
      | Last Name                | TheTester                |
      | Email                    | TheTester@orchard.com.au |
      | Contact Number           | 0431667796               |
      | Postal Code              | 2000                     |
      | Preferred Contact Method | Email                    |
      | Time Purchase Dropdown   | Within 3 months          |
      | Terms and Conditions     | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors

  @GeneralEnquiry
  Scenario: General Enquiry - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/support/contact-us.html#generalenquiry"
    When the user selects "Product" from "Type of Sub Enquiry" dropdown
    And I fill in all required fields
      | Field                  | Value                    |
      | Vehicle Selection      | G70                     |
      | First Name             | Janki                    |
      | Last Name              | TheTester                |
      | Address                | 123 Test Street, Sydney  |
      | Email                  | TheTester@orchard.com.au |
      | Postal Code            | 2000                     |
      | Time Purchase Dropdown | Within 3 months          |
      | Terms and Conditions   | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors

  @DownloadEBrochure
  Scenario: Download E-Brochure - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/support/contact-us.html#downloadebrochure"
    When I fill in all required fields
      | Field                  | Value                    |
      | Vehicle Selection      | G70                    |
      | First Name             | Janki                    |
      | Last Name              | TheTester                |
      | Email                  | TheTester@orchard.com.au |
      | Time Purchase Dropdown | Within 3 months          |
      | Terms and Conditions   | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors

  @BookAService
  Scenario: Book a Service - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/owners/book-a-service.html"
    When I fill in all required fields
      | Field                    | Value                    |
      | First Name               | Janki                    |
      | Last Name                | TheTester                |
      | Email                    | TheTester@orchard.com.au |
      | Contact Number           | 0431667796               |
      | Postal Code              | 2000                     |
      | VIN                      | KMHLT4AG1NU000001        |
      | Registration Number      | ABC123                   |
      | Preferred Contact Method | Email                    |
      | Preferred Date           | 2025-08-15               |
      | Terms and Conditions     | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors

  @Subscribe
  Scenario: Subscribe - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/subscribe.html"
    When I fill in all required fields
      | Field                    | Value                    |
      | First Name               | Janki                    |
      | Last Name                | TheTester                |
      | Email                    | TheTester@orchard.com.au |
      | Contact Number           | 0431667796               |
      | Postal Code              | 2000                     |
      | Preferred Contact Method | Email                    |
      | Time Purchase Dropdown   | Within 3 months          |
      | Terms and Conditions     | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors

  @RYI
  Scenario: RYI - All fields filled succeeds
    Given I navigate to "https://stage.genesis-motors.com.au/au/en/models/gv60-magma-teaser.html"
    When I fill in all required fields
      | Field                    | Value                    |
      | First Name               | Janki                    |
      | Last Name                | TheTester                |
      | Email                    | TheTester@orchard.com.au |
      | Contact Number           | 0431667796               |
      | Postal Code              | 2000                     |
      | Preferred Contact Method | Email                    |
      | Terms and Conditions     | Checked                  |
    And I click Submit
    Then I should see "Thank you" success message
    And I should NOT see "Sorry, something went wrong"
    And I should NOT see any validation errors